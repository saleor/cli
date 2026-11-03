import { Effect, Option } from "effect";
import { cliAppToken } from "../../core/cli-app.ts";
import type { Instance } from "../../core/instance.ts";
import { Session } from "./auth/session.ts";

// A token for a Cloud store's own API, made with the Cloud login, as the previous
// Saleor CLI did: Cloud stores accept the login in the `Authorization-Bearer` header
// (`Authorization` stays free for an environment's basic auth). With it, the CLI makes
// or reuses its own app on the store and saves the app's token (core/cli-app.ts).
// The Cloud login, when there is one; none when not logged in.
const loginToken = Effect.gen(function* () {
  const session = yield* Session;

  return yield* session.credential.pipe(
    Effect.map((credential) => Option.some(credential.token)),
    Effect.catchIf(
      (failure) => failure.code === "AUTH_REQUIRED",
      () => Effect.succeedNone
    )
  );
});

export const cloudAccess = (instance: Instance) =>
  Effect.gen(function* () {
    const login = yield* loginToken;

    // Not logged in: the person supplies a token instead.
    if (Option.isNone(login)) {
      return Option.none<string>();
    }

    return yield* cliAppToken(instance, {
      headers: { "Authorization-Bearer": login.value },
      label: "your Saleor Cloud login",
      otherwise: "it needs a token",
    });
  });

// The Cloud login itself, as a staff user's token: Cloud stores take it as their
// staff user for the account, and Saleor reads it the same way in `Authorization` as
// in `Authorization-Bearer`. Used only where an app token cannot do (installing and
// creating apps), since it lasts less than the app's token.
export const cloudLogin = (_instance: Instance) => loginToken;
