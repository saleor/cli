import { Effect } from "effect";
import { defineActions } from "../../../core/action.ts";
import { result } from "../../../core/command.ts";
import { Session } from "../auth/session.ts";

export const logout = defineActions().session({
  description: "Log out of Saleor Cloud on this computer.",
  inputs: {},
  name: "logout",
  run: () =>
    Effect.gen(function* () {
      const session = yield* Session;
      const { removed } = yield* session.logout;
      const envTokenStillSet = process.env.SALEOR_CLOUD_TOKEN !== undefined;

      return result(
        { envTokenStillSet, removed },
        [
          removed ? "✓ Logged out." : "✓ You were not logged in.",
          envTokenStillSet
            ? "SALEOR_CLOUD_TOKEN is still set in this shell, so commands keep using it. Unset it to log out completely."
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    }),
  summary: "Log out of Saleor Cloud.",
});
