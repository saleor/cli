import { Data, Duration, Effect, Match, Option, Schema } from "effect";
import { converge, done, failWith, wait } from "../../../core/converge.ts";
import { HttpClient, HttpClientRequest } from "effect/http";
import { fail } from "../../../core/errors.ts";
import { command } from "../../../core/invocation.ts";

const TRAILING_SLASHES = /\/+$/;

// Public OAuth client used for device authorization; deployments may override it.
export const DEVICE_CLIENT_ID = process.env.SALEOR_AUTH_CLIENT_ID ?? "jolly";

export const authRealmUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (env.SALEOR_AUTH_URL ?? "https://auth.saleor.io/realms/saleor-cloud").replace(
    TRAILING_SLASHES,
    ""
  );

export const PendingDeviceGrant = Schema.Struct({
  deviceCode: Schema.String,
  expiresAt: Schema.Finite,
  intervalSeconds: Schema.Finite,
  userCode: Schema.String,
  verificationUri: Schema.String,
  verificationUriComplete: Schema.optionalKey(Schema.String),
});

export type PendingDeviceGrant = typeof PendingDeviceGrant.Type;

export const DeviceTokens = Schema.Struct({
  accessExpiresAt: Schema.Finite,
  accessToken: Schema.String,
  clientId: Schema.String,
  refreshExpiresAt: Schema.optionalKey(Schema.Finite),
  refreshToken: Schema.String,
});

export type DeviceTokens = typeof DeviceTokens.Type;

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.String,
  expires_in: Schema.Finite,
  interval: Schema.optionalKey(Schema.Finite),
  user_code: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.optionalKey(Schema.String),
});

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
  refresh_expires_in: Schema.optionalKey(Schema.Finite),
  refresh_token: Schema.String,
});

const postForm = (url: string, form: Record<string, string>) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const response = yield* http
      .execute(
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyUrlParams(form),
          HttpClientRequest.acceptJson
        )
      )
      .pipe(
        Effect.timeout(Duration.seconds(30)),
        Effect.mapError(() =>
          fail(
            "NETWORK_ERROR",
            `Could not reach the Saleor Cloud login server at ${authRealmUrl()}.`,
            { retry: true, suggestion: "Check your internet connection." }
          )
        )
      );

    const body = yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.JsonObject)),
      Effect.orElseSucceed((): Schema.JsonObject => ({}))
    );

    return { body, status: response.status };
  });

export const requestDeviceCode = Effect.gen(function* () {
  const { status, body } = yield* postForm(
    `${authRealmUrl()}/protocol/openid-connect/auth/device`,
    {
      client_id: DEVICE_CLIENT_ID,
      scope: "openid",
    }
  );

  if (status !== 200) {
    return yield* fail(
      "API_ERROR",
      `The Saleor Cloud login server could not start a login (HTTP ${status}).`,
      {
        details: body,
        retry: true,
        suggestion: "Try again in a moment.",
      }
    );
  }

  const parsed = yield* Schema.decodeUnknownEffect(DeviceCodeResponse)(
    body
  ).pipe(
    Effect.mapError(() =>
      fail(
        "API_ERROR",
        "The Saleor Cloud login server sent a response this version of the CLI does not understand."
      )
    )
  );

  const grant: PendingDeviceGrant = {
    deviceCode: parsed.device_code,
    expiresAt: Date.now() + parsed.expires_in * 1000,
    intervalSeconds: parsed.interval ?? 5,
    userCode: parsed.user_code,
    verificationUri: parsed.verification_uri,
  };

  return parsed.verification_uri_complete
    ? { ...grant, verificationUriComplete: parsed.verification_uri_complete }
    : grant;
});

const toTokens = (parsed: typeof TokenResponse.Type): DeviceTokens => {
  const tokens: DeviceTokens = {
    accessExpiresAt: Date.now() + parsed.expires_in * 1000,
    accessToken: parsed.access_token,
    clientId: DEVICE_CLIENT_ID,
    refreshToken: parsed.refresh_token,
  };

  return parsed.refresh_expires_in
    ? {
        ...tokens,
        refreshExpiresAt: Date.now() + parsed.refresh_expires_in * 1000,
      }
    : tokens;
};

// The login server's answer to one poll of a device grant (RFC 8628, section 3.5).
export type GrantAnswer = Data.TaggedEnum<{
  Approved: { readonly tokens: typeof TokenResponse.Type };
  Denied: { readonly error: string };
  Expired: { readonly error: string };
  Pending: { readonly error: string };
  Rejected: { readonly message: string; readonly body: Schema.JsonObject };
  SlowDown: { readonly error: string };
}>;

export const GrantAnswer = Data.taggedEnum<GrantAnswer>();

const unreadable = (body: Schema.JsonObject) =>
  GrantAnswer.Rejected({
    body,
    message:
      "The Saleor Cloud login server sent a response this version of the CLI does not understand.",
  });

const rejectedFor = (status: number, body: Schema.JsonObject) => {
  const error = Schema.is(Schema.String)(body.error) ? body.error : "";

  const description = Schema.is(Schema.String)(body.error_description)
    ? body.error_description
    : "";

  return GrantAnswer.Rejected({
    body,
    message: `Login failed: ${description || error || `HTTP ${status}`}.`,
  });
};

export const classifyGrantAnswer = (
  status: number,
  body: Schema.JsonObject
): GrantAnswer => {
  if (status === 200) {
    return Option.match(Schema.decodeUnknownOption(TokenResponse)(body), {
      onNone: () => unreadable(body),
      onSome: (tokens) => GrantAnswer.Approved({ tokens }),
    });
  }

  const error = Schema.is(Schema.String)(body.error) ? body.error : "";

  return Match.value(error).pipe(
    Match.when("authorization_pending", () => GrantAnswer.Pending({ error })),
    Match.when("slow_down", () => GrantAnswer.SlowDown({ error })),
    Match.when("access_denied", () => GrantAnswer.Denied({ error })),
    Match.when("expired_token", () => GrantAnswer.Expired({ error })),
    Match.orElse(() => rejectedFor(status, body))
  );
};

const codeExpired = () =>
  fail(
    "AUTH_DEVICE_CODE_EXPIRED",
    "The login link expired before the request was approved.",
    {
      retry: true,
      suggestion: `To get a new link, run: ${command("login")}`,
    }
  );

export const decideGrant = GrantAnswer.$match({
  Approved: ({ tokens }) => done(tokens),
  Denied: () =>
    failWith(
      fail(
        "AUTH_DEVICE_ACCESS_DENIED",
        "The login request was denied in the browser.",
        { suggestion: `To try again, run: ${command("login")}` }
      )
    ),
  Expired: () => failWith(codeExpired()),
  Pending: () => wait("waiting for approval"),
  Rejected: ({ body, message }) =>
    failWith(fail("API_ERROR", message, { details: body })),
  SlowDown: () =>
    wait("waiting for approval", { slowDownBy: Duration.seconds(5) }),
});

// Polls until the person approves, honouring `interval` and `slow_down`, and stops when
// the code expires.
export const pollForTokens = (grant: PendingDeviceGrant) =>
  Effect.map(
    converge({
      // The person is acting in the browser; the notice already says it is waiting.
      beat: () => Effect.void,
      deadline: { at: grant.expiresAt },
      decide: decideGrant,
      interval: Duration.seconds(grant.intervalSeconds),
      observe: Effect.map(
        postForm(`${authRealmUrl()}/protocol/openid-connect/token`, {
          client_id: DEVICE_CLIENT_ID,
          device_code: grant.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        ({ body, status }) => classifyGrantAnswer(status, body)
      ),
      timeout: () => Effect.fail(codeExpired()),
      waitFirst: true,
    }),
    toTokens
  );

export const refreshTokens = (tokens: DeviceTokens) =>
  Effect.gen(function* () {
    const { status, body } = yield* postForm(
      `${authRealmUrl()}/protocol/openid-connect/token`,
      {
        client_id: tokens.clientId,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }
    );

    if (status !== 200) {
      return yield* fail(
        "AUTH_REQUIRED",
        "Your Saleor Cloud login has expired.",
        {
          suggestion: `Log in again with: ${command("login")}`,
        }
      );
    }

    const parsed = yield* Schema.decodeUnknownEffect(TokenResponse)(body).pipe(
      Effect.mapError(() =>
        fail(
          "API_ERROR",
          "The Saleor Cloud login server sent a response this version of the CLI does not understand."
        )
      )
    );

    return toTokens(parsed);
  });
