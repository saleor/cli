import { Effect } from "effect";
import { askConfirm, isInteractive } from "../../../core/interaction.ts";
import { notice } from "../../../core/output.ts";
import { currentUser } from "./current-user.ts";
import { deviceLogin } from "./device-login.ts";
import { Session } from "./session.ts";

// Offers browser login instead of failing when nobody is logged in. Returns once
// credentials exist, so the original command can continue. Without a terminal it does
// nothing, and the first Cloud request reports AUTH_REQUIRED.
export const ensureLoggedIn = Effect.gen(function* () {
  if (!(yield* isInteractive)) {
    return;
  }

  const session = yield* Session;

  const loggedIn = yield* session.credential.pipe(
    Effect.as(true),
    Effect.catchIf(
      (failure) => failure.code === "AUTH_REQUIRED",
      (failure) =>
        Effect.gen(function* () {
          yield* notice(failure.message);

          if (!(yield* askConfirm("Log in now in your browser?"))) {
            return yield* failure;
          }

          yield* deviceLogin(true);

          return false;
        })
    )
  );

  if (!loggedIn) {
    const user = yield* currentUser;
    yield* notice(`✓ Logged in as ${user.email}.`);
  }
});
