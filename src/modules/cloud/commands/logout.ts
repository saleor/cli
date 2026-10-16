import { Effect } from "effect";
import { Command } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { Session } from "../auth/session.ts";

export const logout = Command.make("logout", {}, () =>
  run(
    Effect.gen(function* () {
      const session = yield* Session;
      const { removed } = yield* session.logout;
      const envStillSet = process.env.SALEOR_CLOUD_TOKEN !== undefined;

      return result(
        { envTokenStillSet: envStillSet, removed },
        [
          removed ? "✓ Logged out." : "You were not logged in.",
          envStillSet
            ? "SALEOR_CLOUD_TOKEN is still set in this shell, so commands keep using it. Unset it to log out completely."
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    })
  )
).pipe(Command.withDescription("Log out of Saleor Cloud on this computer."));
