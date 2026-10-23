import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { fail } from "../../../core/errors.ts";

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

// Polls until the person approves, honouring `interval` and `slow_down`, and stops when
// the code expires.
export const pollForTokens = (grant: PendingDeviceGrant) =>
  Effect.gen(function* () {
    let interval = grant.intervalSeconds;

    for (;;) {
      if (Date.now() >= grant.expiresAt) {
        return yield* fail(
          "AUTH_DEVICE_CODE_EXPIRED",
          "The login link expired before the request was approved.",
          {
            retry: true,
            suggestion: "To get a new link, run: saleor login",
          }
        );
      }

      yield* Effect.sleep(Duration.seconds(interval));

      const { status, body } = yield* postForm(
        `${authRealmUrl()}/protocol/openid-connect/token`,
        {
          client_id: DEVICE_CLIENT_ID,
          device_code: grant.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }
      );

      if (status === 200) {
        const parsed = yield* Schema.decodeUnknownEffect(TokenResponse)(
          body
        ).pipe(
          Effect.mapError(() =>
            fail(
              "API_ERROR",
              "The Saleor Cloud login server sent a response this version of the CLI does not understand."
            )
          )
        );

        return toTokens(parsed);
      }

      const error = String(body.error ?? "");

      switch (error) {
        case "authorization_pending":
          continue;
        case "slow_down":
          interval += 5;
          continue;
        case "access_denied":
          return yield* fail(
            "AUTH_DEVICE_ACCESS_DENIED",
            "The login request was denied in the browser.",
            {
              suggestion: "To try again, run: saleor login",
            }
          );
        case "expired_token":
          return yield* fail(
            "AUTH_DEVICE_CODE_EXPIRED",
            "The login link expired before the request was approved.",
            {
              retry: true,
              suggestion: "To get a new link, run: saleor login",
            }
          );
        default:
          break;
      }

      return yield* fail(
        "API_ERROR",
        `Login failed: ${String(body.error_description ?? "") || error || `HTTP ${status}`}.`,
        { details: body }
      );
    }
  });

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
          suggestion: "Log in again with: saleor login",
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
