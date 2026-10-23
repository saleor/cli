import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type CliFailure, fail } from "../../../core/errors.ts";
import { Session } from "../auth/session.ts";
import { listOrganizations } from "./contract.ts";

const TRAILING_SLASHES = /\/+$/;

export const cloudApiBaseUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (env.SALEOR_CLOUD_API_URL ?? "https://cloud.saleor.io/platform").replace(
    TRAILING_SLASHES,
    ""
  );

interface Operation {
  readonly method:
    | "GET"
    | "POST"
    | "DELETE"
    | "PUT"
    | "PATCH"
    | "HEAD"
    | "OPTIONS";
  readonly path: string;
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly request: Schema.ConstraintEncoder<unknown> | undefined;
  readonly response: Schema.ConstraintDecoder<unknown> | undefined;
  readonly successStatus: number;
}

type ResponseOf<O> = O extends { readonly response: infer S extends Schema.Top }
  ? S["Type"]
  : undefined;

type BodyOf<O> = O extends { readonly request: infer S extends Schema.Top }
  ? S["Type"]
  : never;

export interface CallOptions<O extends Operation> {
  readonly body?: BodyOf<O>;
  readonly path?: Record<O["pathParams"][number], string>;
  readonly query?: Partial<Record<O["queryParams"][number], string>>;
}

// Raised for a non-2xx answer so callers can map server-side validation messages
// (domain taken, environment limit) to stable codes before it becomes a CliFailure.
export class ApiStatusError extends Data.TaggedError("ApiStatusError")<{
  readonly status: number;
  readonly body: Schema.Json | undefined;
  readonly operation: string;
}> {}

// The task-status endpoint accepts anonymous requests and rejects Cloud tokens.
const ANONYMOUS_PATHS = new Set(["/api/service/task-status/{job_name}/"]);

const isTransient = (status: number) =>
  status === 429 || (status >= 500 && status <= 504);

const isIdempotent = (method: string) =>
  method === "GET" || method === "DELETE";

const retryTransient = Schedule.exponential(Duration.millis(400));

export const describeApiError = (error: ApiStatusError): CliFailure => {
  switch (error.status) {
    case 401:
      return fail(
        "AUTH_INVALID",
        process.env.SALEOR_CLOUD_TOKEN
          ? "Saleor Cloud rejected SALEOR_CLOUD_TOKEN."
          : "Your Saleor Cloud login is no longer valid.",
        {
          suggestion: process.env.SALEOR_CLOUD_TOKEN
            ? "Check the token. To use your own login instead, unset SALEOR_CLOUD_TOKEN and run: saleor login"
            : "Log in again with: saleor login",
        }
      );
    case 403:
      return fail(
        "FORBIDDEN",
        "Your account does not have permission to do this.",
        {
          details: error.body,
          suggestion:
            "Check that you belong to the organization and that your role allows this.\nSee your organizations with: saleor whoami",
        }
      );
    case 404:
      return fail(
        "NOT_FOUND",
        "Saleor Cloud could not find what this command asked for.",
        {
          details: { body: error.body, operation: error.operation },
          suggestion:
            "Check the organization, project and environment names.\nSee your organizations with: saleor whoami",
        }
      );
    default:
      if (error.status >= 400 && error.status < 500) {
        return fail(
          "API_VALIDATION_ERROR",
          `Saleor Cloud rejected the request: ${flattenMessages(error.body) || `HTTP ${error.status}`}`,
          {
            details: error.body,
          }
        );
      }

      return fail(
        "API_ERROR",
        `Saleor Cloud returned an error (HTTP ${error.status}).`,
        {
          details: error.body,
          retry: true,
          suggestion: "Try again in a moment.",
        }
      );
  }
};

// DRF errors come as {"field": ["message", ...]} or {"detail": "message"}.
export const flattenMessages = (body: Schema.Json | undefined): string =>
  Match.value(body).pipe(
    Match.when(Schema.is(Schema.String), (text) => text),
    Match.when(Schema.is(Schema.Array(Schema.Json)), (items) =>
      items.map(flattenMessages).join("; ")
    ),
    Match.when(Schema.is(Schema.JsonObject), (fields) =>
      Object.entries(fields)
        .map(([key, value]) =>
          key === "detail" || key === "non_field_errors"
            ? flattenMessages(value)
            : `${key}: ${flattenMessages(value)}`
        )
        .join("; ")
    ),
    Match.orElse(String)
  );

class TransientError extends Data.TaggedError("TransientError")<{
  readonly status: number;
}> {}

export interface CloudApiService {
  readonly call: <O extends Operation>(
    operation: O,
    options?: CallOptions<O>
  ) => Effect.Effect<ResponseOf<O>, ApiStatusError | CliFailure>;
}

export class CloudApi extends Context.Service<CloudApi, CloudApiService>()(
  "saleor/cloud/CloudApi"
) {}

const operationPath = (
  operation: Operation,
  options: Pick<CallOptions<Operation>, "path">
) =>
  Effect.gen(function* () {
    let url = operation.path;

    for (const name of operation.pathParams) {
      const value = Object.entries(options.path ?? {}).find(
        ([key]) => key === name
      )?.[1];

      if (value === undefined) {
        return yield* fail("INTERNAL_ERROR", `Missing path parameter ${name}`);
      }

      url = url.replace(`{${name}}`, encodeURIComponent(value));
    }

    return url;
  });

const validateRequest = <O extends Operation>(
  operation: O,
  options: CallOptions<O>
) =>
  Effect.gen(function* () {
    const validate = <S extends Schema.ConstraintEncoder<unknown>>(
      schema: S,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the I/O boundary that validates the value against the supplied schema.
      value: unknown
    ) =>
      Schema.encodeUnknownEffect(schema)(value, {
        onExcessProperty: "error",
      }).pipe(
        Effect.mapError(() =>
          fail(
            "INTERNAL_ERROR",
            "The CLI produced an invalid Cloud API request.",
            {
              details: { operation: operation.path },
            }
          )
        )
      );

    yield* validate(
      operation.pathParams.length === 0
        ? Schema.Record(Schema.String, Schema.Never)
        : Schema.Struct(
            Object.fromEntries(
              operation.pathParams.map((name) => [name, Schema.String])
            )
          ),
      options.path ?? {}
    );
    yield* validate(
      operation.queryParams.length === 0
        ? Schema.Record(Schema.String, Schema.Never)
        : Schema.Struct(
            Object.fromEntries(
              operation.queryParams.map((name) => [
                name,
                Schema.optionalKey(Schema.String),
              ])
            )
          ),
      options.query ?? {}
    );

    return yield* validate(operation.request ?? Schema.Undefined, options.body);
  });

export const CloudApiLive = Layer.effect(
  CloudApi,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const session = yield* Session;
    const baseUrl = cloudApiBaseUrl();

    // SAFETY: the descriptor ties its response schema to ResponseOf<O>; the decoder validates the payload. Context-free schema constraints preserve the error and requirements channels.
    const call = <O extends Operation>(
      operation: O,
      options: CallOptions<O> = {}
    ): Effect.Effect<ResponseOf<O>, ApiStatusError | CliFailure> =>
      Effect.gen(function* () {
        const encoded = yield* validateRequest(operation, options);
        const url = yield* operationPath(operation, options);

        let request = HttpClientRequest.make(operation.method)(
          `${baseUrl}${url}`
        ).pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.setUrlParams(options.query ?? {})
        );

        if (!ANONYMOUS_PATHS.has(operation.path)) {
          const credential = yield* session.credential;
          request = HttpClientRequest.setHeader(
            request,
            "Authorization",
            `${credential.scheme} ${credential.token}`
          );
        }

        if (options.body !== undefined && operation.request !== undefined) {
          request = HttpClientRequest.bodyJsonUnsafe(request, encoded);
        }

        const response = yield* http.execute(request).pipe(
          Effect.timeout(Duration.seconds(30)),
          Effect.filterOrFail(
            (res) => !isTransient(res.status),
            (res) => new TransientError({ status: res.status })
          ),
          // A create that timed out or hit a 5xx may still have happened, so only 429 is
          // retried for writes; the caller's name-based lookup recovers the rest on re-run.
          Effect.retry({
            schedule: retryTransient,
            times: 4,
            while: (error) =>
              isIdempotent(operation.method) ||
              (Predicate.isTagged(error, "TransientError") &&
                error.status === 429),
          }),
          Effect.mapError((error) =>
            Predicate.isTagged(error, "TransientError")
              ? fail(
                  "API_ERROR",
                  `Saleor Cloud is temporarily unavailable (HTTP ${error.status}).`,
                  {
                    retry: true,
                    suggestion: "Try again in a moment.",
                  }
                )
              : fail(
                  "NETWORK_ERROR",
                  `Could not reach Saleor Cloud at ${baseUrl}.`,
                  {
                    retry: true,
                    suggestion: process.env.SALEOR_CLOUD_API_URL
                      ? "Check your internet connection and the SALEOR_CLOUD_API_URL setting."
                      : "Check your internet connection.",
                  }
                )
          )
        );

        const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        const body = text.length > 0 ? safeJson(text) : undefined;

        yield* requireMembership(response.status, options.path);

        if (response.status < 200 || response.status >= 300) {
          return yield* new ApiStatusError({
            body,
            operation: operation.path,
            status: response.status,
          });
        }

        if (operation.response === undefined) {
          return;
        }

        return yield* Schema.decodeEffect(operation.response)(body).pipe(
          Effect.mapError((issue) => unreadableResponse(operation, issue))
        );
      }) as Effect.Effect<ResponseOf<O>, ApiStatusError | CliFailure>;

    // Cloud answers 404 for an organization the caller does not belong to, the same
    // as for a missing project or environment. Name the organization when it is that.
    const requireMembership = (
      status: number,
      path: Record<string, string> | undefined
    ) =>
      Effect.gen(function* () {
        const slug = path?.organization_slug;

        if (status !== 404 || slug === undefined) {
          return;
        }

        const organizations = yield* call(listOrganizations).pipe(
          Effect.orElseSucceed(() => undefined)
        );

        if (
          organizations === undefined ||
          organizations.some((org) => org.slug === slug)
        ) {
          return;
        }

        const slugs = organizations.map((org) => org.slug);

        return yield* fail(
          "NOT_FOUND",
          `Organization "${slug}" does not exist, or your account does not belong to it.`,
          {
            details: { organizations: slugs },
            suggestion:
              slugs.length > 0
                ? `Your organizations: ${slugs.join(", ")}.`
                : "Your account does not belong to any organization yet.",
          }
        );
      });

    return { call };
  })
);

// A write that answered 2xx happened, even if its answer cannot be read; telling the
// caller otherwise would make it create a second resource.
const unreadableResponse = (
  operation: Operation,
  issue: Schema.SchemaError
) => {
  const details = { issue: String(issue), operation: operation.path };

  return isIdempotent(operation.method)
    ? fail(
        "API_ERROR",
        "Saleor Cloud returned a response this version of the CLI does not understand.",
        {
          details,
          suggestion:
            "Update the Saleor CLI. If it still happens, please report it.",
        }
      )
    : fail(
        "API_ERROR",
        "Saleor Cloud accepted the request, but this version of the CLI could not read its answer.",
        {
          details,
          retry: true,
          suggestion:
            "The change was probably made. Run the same command again to check; it reuses what already exists. If it keeps happening, please report it.",
        }
      );
};

const safeJson = (text: string): Schema.Json => {
  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
  } catch {
    return text;
  }
};

// Turns any remaining ApiStatusError into a CliFailure; call sites that understand a
// specific rejection catch it first.
export const orDescribe = <A, R>(
  effect: Effect.Effect<A, ApiStatusError | CliFailure, R>
) =>
  Effect.catchTag(effect, "ApiStatusError", (error) =>
    Effect.fail(describeApiError(error))
  );
