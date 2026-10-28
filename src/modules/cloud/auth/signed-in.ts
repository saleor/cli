import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { SecretStoreLive } from "../../../core/secret-store.ts";
import { Session, SessionLive } from "./session.ts";

export const sessionLayer = SessionLive.pipe(
  Layer.provide(SecretStoreLive),
  Layer.provide(FetchHttpClient.layer)
);

// Whether Cloud credentials exist, by a saved login or SALEOR_CLOUD_TOKEN. Reads local
// storage only: an expired login still counts, so menus never wait on the network.
export const signedIn = Effect.gen(function* () {
  const session = yield* Session;

  return (yield* session.status).source !== "none";
}).pipe(Effect.provide(sessionLayer));

// Who Cloud commands act as, for showing before a choice that may use Cloud.
export const account = Effect.gen(function* () {
  const session = yield* Session;
  const { email, source } = yield* session.status;

  if (source === "env") {
    return "Using Saleor Cloud with SALEOR_CLOUD_TOKEN.";
  }

  if (source === "login") {
    return email === undefined
      ? "Logged in to Saleor Cloud."
      : `Logged in to Saleor Cloud as ${email}.`;
  }
}).pipe(Effect.provide(sessionLayer));
