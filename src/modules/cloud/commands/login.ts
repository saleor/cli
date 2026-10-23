import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { isInteractive } from "../../../core/interaction.ts";
import { ContinueInCli } from "../../../core/navigation.ts";
import { notice, useColors, writeText } from "../../../core/output.ts";
import { currentUser } from "../auth/current-user.ts";
import { DEVICE_CLIENT_ID } from "../auth/device-grant.ts";
import { deviceLogin } from "../auth/device-login.ts";
import { Session } from "../auth/session.ts";

export const login = Command.make(
  "login",
  {
    noBrowser: Flag.Boolean("no-browser").pipe(
      Flag.withDescription("Only print the login link; do not open a browser."),
      Flag.withDefault(false)
    ),
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const session = yield* Session;
        const before = yield* session.status;

        if (before.source === "login") {
          // A saved login may have expired; logging in again is how to renew it.
          const current = yield* currentUser.pipe(Effect.option);

          if (Option.isSome(current)) {
            yield* notice(
              `Already logged in as ${current.value.email}. Approving this login replaces it; press Ctrl+C to keep it.`
            );
          }
        }

        if (before.source !== "env") {
          yield* deviceLogin(!flags.noBrowser);
        }

        const { label: _, ...user } = yield* currentUser;
        const status = yield* session.status;

        const interactive = yield* isInteractive;

        if (interactive) {
          const title = `✦  Welcome${user.name ? `, ${user.name}` : ""}!`;
          const heading = useColors() ? `\x1b[1;35m${title}\x1b[0m` : title;
          yield* writeText(
            [
              "",
              heading,
              "",
              `✓  You're signed in as ${user.email}.`,
              "   Your next store starts here.",
              "",
            ].join("\n")
          );
          yield* yield* ContinueInCli;
        }

        const successMessage =
          status.source === "env"
            ? `SALEOR_CLOUD_TOKEN is set, so no login is needed. Using it as ${user.email}.`
            : `✓ Logged in as ${user.email}.`;

        return result(
          {
            ...user,
            clientId: DEVICE_CLIENT_ID,
            credentialSource: status.source,
            credentialStore: status.store,
          },
          interactive ? "" : successMessage
        );
      })
    )
).pipe(
  Command.withDescription(
    "Log in to Saleor Cloud. Opens your browser to approve the login; then keeps you in the CLI with a menu of next steps in an interactive terminal. Not needed when SALEOR_CLOUD_TOKEN is set."
  ),
  Command.withShortDescription("Log in to Saleor Cloud in your browser.")
);
