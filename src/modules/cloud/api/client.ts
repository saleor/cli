const TRAILING_SLASHES = /\/+$/;

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

// task-status is anonymous: sending the Cloud token makes it try to decode the token as
// a JWT and fail with 401 "Error decoding signature".
const ANONYMOUS_PATHS = new Set(["/api/service/task-status/{job_name}/"]);

const isTransient = (status: number) =>
  status === 429 || (status >= 500 && status <= 504);

const isIdempotent = (method: string) =>
  method === "GET" || method === "DELETE";

const retryTransient = Schedule.exponential(Duration.millis(400));

export const describeApiError = (error: ApiStatusError): CliFailure => {
  switch (error.status) {
    case 401:
      return fail("AUTH_INVALID", "Saleor Cloud rejected the credentials.", {
        suggestion: "Run `saleor login`, or check SALEOR_CLOUD_TOKEN.",
      });
    case 403:
      return fail(
        "FORBIDDEN",
        "Your account is not allowed to do this in that organization.",
        {
          details: error.body,
        }
      );
    case 404:
      return fail("NOT_FOUND", `Not found (${error.operation}).`, {
        details: error.body,
      });
    default:
      if (error.status >= 400 && error.status < 500) {
        return fail(
          "API_VALIDATION_ERROR",
          `Saleor Cloud rejected the request: ${flattenMessages(error.body)}`,
          {
            details: error.body,
          }
        );
      }

      return fail("API_ERROR", `Saleor Cloud answered HTTP ${error.status}.`, {
        details: error.body,
        retry: true,
      });
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
        return yield* Effect.die(new Error(`Missing path parameter ${name}`));
      }

      url = url.replace(`{${name}}`, encodeURIComponent(value));
    }

    return url;
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
          const encoded = yield* Schema.encodeUnknownEffect(operation.request)(
            options.body
          ).pipe(Effect.orDie);

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
                  `Saleor Cloud is unavailable (HTTP ${error.status}).`,
                  {
                    retry: true,
                  }
                )
              : fail(
                  "NETWORK_ERROR",
                  `Could not reach Saleor Cloud at ${baseUrl}.`,
                  {
                    retry: true,
                    suggestion:
                      "Check your connection or SALEOR_CLOUD_API_URL.",
                  }
                )
          )
        );

        const text = yield* response.text.pipe(Effect.orElseSucceed(() => ""));
        const body = text.length > 0 ? safeJson(text) : undefined;

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
          Effect.mapError((issue) =>
            fail(
              "API_ERROR",
              `Saleor Cloud returned an unexpected response for ${operation.path}.`,
              { details: String(issue) }
            )
          )
        );
      }) as Effect.Effect<ResponseOf<O>, ApiStatusError | CliFailure>;

    return { call };
  })
);

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
