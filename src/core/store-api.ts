import { Effect, Option, Predicate, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type CliFailure, fail } from "./errors.ts";
import type { Instance } from "./instance.ts";
import { resolveInstance } from "./instances.ts";
import { storeAccess, type StoreAccessOptions } from "./store-access.ts";

// A store's own GraphQL API, for commands that talk to it directly rather than through
// Configurator: one request, its answer, and the failures every caller reports the same
// way. The token comes from storeAccess; this never decides where tokens come from.

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

const unreachable = (url: string) =>
  fail("NETWORK_ERROR", `Could not reach the store at ${url}.`, {
    suggestion: "Check that the store is running, then run the command again.",
  });

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
export const storeFailure = (
  instance: Instance,
  answer: StoreAnswer
): CliFailure => {
  const message = answer.errors.map((error) => error.message).join("; ");
  const details = { data: answer.data, errors: answer.errors };

  if (
    answer.errors.some((error) => AUTH_CODES.has(codeOf(error) ?? "")) ||
    message.includes("permission")
  ) {
    return fail(
      "STORE_AUTH_INVALID",
      `${instance.ref} refused the request: ${message}`,
      {
        details,
        suggestion:
          "Use a token with that permission: set SALEOR_TOKEN, or run this in a terminal to enter one.",
      }
    );
  }

  return fail("STORE_ERROR", `${instance.ref} returned an error: ${message}`, {
    details,
  });
};

// A request whose answer must have no errors; its data, otherwise the failure.
export const storeQuery = (
  instance: Instance,
  request: Omit<StoreRequest, "url">
) =>
  Effect.flatMap(
    storeRequest({ ...request, url: instance.graphqlUrl }),
    (answer) =>
      answer.errors.length > 0
        ? Effect.fail(storeFailure(instance, answer))
        : Effect.succeed(answer.data)
  );

export interface Connected {
  readonly instance: Instance;
  // None when the command was told to send no token.
  readonly token: Option.Option<string>;
}

// The store named by `<env>` (or the project's, or a pick), and a token for its API.
export const connectStore = (
  env: Option.Option<string>,
  options: StoreAccessOptions & { readonly anonymous?: boolean } = {}
) =>
  Effect.gen(function* () {
    const resolved = yield* resolveInstance(env);

    if (options.anonymous === true) {
      return {
        instance: resolved.instance,
        token: Option.none(),
      } satisfies Connected;
    }

    const access = yield* storeAccess(resolved, options);

    return {
      instance: resolved.instance,
      token: Option.some(access.token),
    } satisfies Connected;
  });
