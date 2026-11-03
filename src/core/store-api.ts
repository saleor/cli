import { Duration, Effect, type Option, Predicate, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type CliFailure, fail } from "./errors.ts";
import type { Store } from "./store.ts";
import { resolveStore, sourceFor } from "./stores.ts";
import { storeToken, type StoreTokenOptions } from "./store-token.ts";

// A store's own GraphQL API, for commands that talk to it directly rather than through
// Configurator: one request, its answer, and the failures every caller reports the same
// way. The token comes from storeToken; this never decides where tokens come from.

// A store and a token for its API: what every command that changes a store holds.
export interface StoreClient {
  readonly store: Store;
  readonly token: string;
}

export interface StoreError {
  readonly extensions?: Readonly<Record<string, Schema.Json>> | undefined;
  readonly message: string;
}

export interface StoreAnswer {
  readonly data: Schema.Json | null;
  readonly errors: readonly StoreError[];
}

export interface StoreRequest {
  // Extra headers, such as a Cloud login sent as `Authorization-Bearer`.
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly query: string;
  // Absent: sent without a token, as anyone may for public data.
  readonly token?: string | undefined;
  readonly url: string;
  readonly variables?: Schema.JsonObject | undefined;
}

const Answer = Schema.Struct({
  data: Schema.optionalKey(Schema.NullOr(Schema.Json)),
  errors: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        extensions: Schema.optionalKey(
          Schema.Record(Schema.String, Schema.Json)
        ),
        message: Schema.String,
      })
    )
  ),
});

// The `errors` every Saleor mutation answers with.
export const MutationErrors = Schema.Array(
  Schema.Struct({
    code: Schema.optionalKey(Schema.NullOr(Schema.String)),
    field: Schema.optionalKey(Schema.NullOr(Schema.String)),
    message: Schema.NullOr(Schema.String),
  })
);

export type MutationErrors = typeof MutationErrors.Type;

// Saleor's permissions as it lists them: `[{ code: "MANAGE_APPS" }]`.
export const PermissionCodes = Schema.Array(
  Schema.Struct({ code: Schema.String })
);

const unreachable = (url: string) =>
  fail("NETWORK_ERROR", `Could not reach the store at ${url}.`, {
    suggestion: "Check that the store is running, then run the command again.",
  });

export const unexpectedAnswer = (store: Store) =>
  fail(
    "STORE_ERROR",
    `${store.ref} answered in a shape this CLI does not know.`
  );

// A mutation the store refused, with Saleor's reasons.
export const mutationRejected = (
  store: Store,
  what: string,
  errors: MutationErrors
) =>
  fail(
    "STORE_ERROR",
    `${store.ref} did not ${what}: ${errors
      .map((error) =>
        [error.field, error.message ?? error.code].filter(Boolean).join(": ")
      )
      .join("; ")}`,
    { details: { errors } }
  );

// One request. GraphQL errors are part of the answer, not a failure: callers decide
// whether partial data is useful. Only a store that cannot be reached, or that answers
// with something other than GraphQL, fails here.
export const storeRequest = ({
  headers = {},
  query,
  token,
  url,
  variables,
}: StoreRequest) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    let request = HttpClientRequest.post(url).pipe(
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeaders(headers),
      HttpClientRequest.bodyJsonUnsafe(
        variables === undefined ? { query } : { query, variables }
      )
    );

    if (token !== undefined) {
      request = HttpClientRequest.setHeader(
        request,
        "Authorization",
        `Bearer ${token}`
      );
    }

    const response = yield* http
      .execute(request)
      .pipe(Effect.mapError(() => unreachable(url)));

    const body = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Answer)),
      Effect.mapError(() =>
        fail(
          "STORE_ERROR",
          `The store at ${url} did not answer with GraphQL (HTTP ${response.status}).`,
          { suggestion: "Check that the address is a Saleor GraphQL API." }
        )
      )
    );

    return {
      data: body.data ?? null,
      errors: body.errors ?? [],
    } satisfies StoreAnswer;
  });

// Saleor's codes for a token it does not accept, or one without a permission.
const AUTH_CODES = new Set([
  "DecodeError",
  "ExpiredSignatureError",
  "InvalidSignatureError",
  "InvalidTokenError",
  "JSONWebTokenError",
  "PermissionDenied",
]);

const codeOf = (error: StoreError) => {
  const exception = error.extensions?.exception;

  return Predicate.isObject(exception) &&
    !Array.isArray(exception) &&
    Predicate.isString(exception.code)
    ? exception.code
    : undefined;
};

// The failure for an answer with errors: the token's fault, or the store's. Saleor's
// permission messages name the permission that is missing, so they are kept as is.
export const storeFailure = (store: Store, answer: StoreAnswer): CliFailure => {
  const message = answer.errors.map((error) => error.message).join("; ");
  const details = { data: answer.data, errors: answer.errors };

  if (
    answer.errors.some((error) => AUTH_CODES.has(codeOf(error) ?? "")) ||
    message.includes("permission")
  ) {
    return fail(
      "STORE_AUTH_INVALID",
      `${store.ref} refused the request: ${message}`,
      {
        details,
        suggestion:
          "Use a token with that permission: set SALEOR_TOKEN, or run this in a terminal to enter one.",
      }
    );
  }

  return fail("STORE_ERROR", `${store.ref} returned an error: ${message}`, {
    details,
  });
};

// A request whose answer must have no errors; its data, otherwise the failure.
export const storeQuery = (store: Store, request: Omit<StoreRequest, "url">) =>
  Effect.flatMap(
    storeRequest({ ...request, url: store.graphqlUrl }),
    (answer) =>
      answer.errors.length > 0
        ? Effect.fail(storeFailure(store, answer))
        : Effect.succeed(answer.data)
  );

// A request as `client`, its data decoded by `schema`.
export const storeData = <S extends Schema.Top>(
  client: StoreClient,
  schema: S,
  request: { readonly query: string; readonly variables?: Schema.JsonObject }
) =>
  storeQuery(client.store, { ...request, token: client.token }).pipe(
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(schema)(data).pipe(
        Effect.mapError(() => unexpectedAnswer(client.store))
      )
    )
  );

const Shop = Schema.Struct({
  shop: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ name: Schema.String }))
  ),
});

// Whether a store's API answers at all. A finished setup does not mean the store
// answers yet; cold starts can take minutes.
export const storeAnswers = (graphqlUrl: string) =>
  storeRequest({ query: "query { shop { name } }", url: graphqlUrl }).pipe(
    Effect.timeout(Duration.seconds(15)),
    Effect.flatMap((answer) => Schema.decodeUnknownEffect(Shop)(answer.data)),
    Effect.map((data) => data.shop !== undefined && data.shop !== null),
    Effect.orElseSucceed(() => false)
  );

// The store named by `<env>` (or the project's, or a pick), and a token for its API.
export const connectStore = (
  env: Option.Option<string>,
  options: StoreTokenOptions = {}
) =>
  Effect.gen(function* () {
    const resolved = yield* resolveStore(env);
    const { token } = yield* storeToken(resolved, options);

    return { store: resolved.store, token } satisfies StoreClient;
  });

// The same for a store this command already has, such as one `init` just made.
export const connectTo = (store: Store, options: StoreTokenOptions = {}) =>
  Effect.gen(function* () {
    const source = yield* sourceFor(store.ref);
    const { token } = yield* storeToken({ source, store }, options);

    return { store, token } satisfies StoreClient;
  });
