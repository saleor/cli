import { Context, Effect, Layer, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { type CliFailure, fail } from "../../../core/errors.ts";
import { SecretStore } from "../../../core/secret-store.ts";
import {
  DeviceTokens,
  PendingDeviceGrant,
  refreshTokens,
} from "./device-grant.ts";

const CREDENTIALS_KEY = "cloud:credentials";
const PENDING_GRANT_KEY = "cloud:pending-device-grant";

// Refresh a little before expiry so a request never leaves with a token that dies in flight.
const EXPIRY_SKEW_MS = 30_000;

export interface Credential {
  // Cloud API tokens (dashboard /tokens) use `Token`; Keycloak JWTs use `Bearer`.
  readonly scheme: "Token" | "Bearer";
  readonly source: "env" | "login";
  readonly token: string;
}

export const schemeFor = (token: string): Credential["scheme"] =>
  token.split(".").length === 3 ? "Bearer" : "Token";

const isFresh = (tokens: DeviceTokens) =>
  tokens.accessExpiresAt - EXPIRY_SKEW_MS > Date.now();

const loginCredential = (tokens: DeviceTokens): Credential => ({
  scheme: "Bearer",
  source: "login",
  token: tokens.accessToken,
});

export interface SessionService {
  readonly clearPendingGrant: Effect.Effect<void>;
  readonly credential: Effect.Effect<Credential, CliFailure>;
  readonly logout: Effect.Effect<{ readonly removed: boolean }>;
  readonly pendingGrant: Effect.Effect<PendingDeviceGrant | undefined>;
  readonly saveLogin: (tokens: DeviceTokens) => Effect.Effect<void>;
  readonly savePendingGrant: (grant: PendingDeviceGrant) => Effect.Effect<void>;
  readonly status: Effect.Effect<{
    readonly source: "env" | "login" | "none";
    readonly store: string;
  }>;
}

export class Session extends Context.Service<Session, SessionService>()(
  "saleor/cloud/Session"
) {}

const decodeStored = <A, I>(
  schema: Schema.Codec<A, I>,
  raw: string | undefined
) => {
  if (raw === undefined) {
    return;
  }

  try {
    return Schema.decodeUnknownSync(schema)(JSON.parse(raw));
  } catch {
    // Corrupt or incompatible credentials require a new login.
  }
};

export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const store = yield* SecretStore;
    const envToken = () => process.env.SALEOR_CLOUD_TOKEN?.trim() || undefined;

    const loadTokens = Effect.map(store.get(CREDENTIALS_KEY), (raw) =>
      decodeStored(DeviceTokens, raw)
    );

    const credential: Effect.Effect<
      Credential,
      CliFailure,
      HttpClient.HttpClient
    > = Effect.gen(function* () {
      const fromEnv = envToken();

      if (fromEnv !== undefined) {
        return {
          scheme: schemeFor(fromEnv),
          source: "env" as const,
          token: fromEnv,
        };
      }

      const tokens = yield* loadTokens;

      if (tokens === undefined) {
        return yield* fail(
          "AUTH_REQUIRED",
          "You are not logged in to Saleor Cloud.",
          {
            suggestion:
              "Log in with: saleor login\nFor CI and scripts, set SALEOR_CLOUD_TOKEN instead.",
          }
        );
      }

      if (isFresh(tokens)) {
        return loginCredential(tokens);
      }

      const refreshed = yield* refreshTokens(tokens).pipe(
        Effect.tap((fresh) =>
          store.set(CREDENTIALS_KEY, JSON.stringify(fresh))
        ),
        // Keycloak rotates refresh tokens, so when two CLI processes refresh at once
        // the slower one is refused. If the other process already stored new tokens,
        // use those instead of asking the person to log in again.
        Effect.catchTag("CliFailure", (failure) =>
          loadTokens.pipe(
            Effect.filterOrFail(
              (latest): latest is DeviceTokens =>
                latest !== undefined &&
                latest.refreshToken !== tokens.refreshToken &&
                isFresh(latest),
              () => failure
            )
          )
        )
      );

      return loginCredential(refreshed);
    });

    const http = yield* Effect.context<HttpClient.HttpClient>();

    return {
      clearPendingGrant: store.remove(PENDING_GRANT_KEY),
      credential: Effect.provide(credential, http),
      logout: Effect.gen(function* () {
        const existing = yield* store.get(CREDENTIALS_KEY);
        yield* store.remove(CREDENTIALS_KEY);
        yield* store.remove(PENDING_GRANT_KEY);

        return { removed: existing !== undefined };
      }),
      pendingGrant: Effect.map(store.get(PENDING_GRANT_KEY), (raw) =>
        decodeStored(PendingDeviceGrant, raw)
      ),
      saveLogin: (tokens) => store.set(CREDENTIALS_KEY, JSON.stringify(tokens)),
      savePendingGrant: (grant) =>
        store.set(PENDING_GRANT_KEY, JSON.stringify(grant)),
      status: Effect.gen(function* () {
        if (envToken() !== undefined) {
          return { source: "env" as const, store: store.backend };
        }

        const tokens = yield* loadTokens;

        return {
          source: tokens === undefined ? ("none" as const) : ("login" as const),
          store: store.backend,
        };
      }),
    };
  })
);
