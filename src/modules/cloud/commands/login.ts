import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { notice } from "../../../core/output.ts";
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

        return result(
          {
            ...user,
            clientId: DEVICE_CLIENT_ID,
            credentialSource: status.source,
            credentialStore: status.store,
          },
          status.source === "env"
            ? `SALEOR_CLOUD_TOKEN is set, so no login is needed. Using it as ${user.email}.`
            : `✓ Logged in as ${user.email}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Log in to Saleor Cloud. Opens your browser to approve the login; the command finishes once you do. Not needed when SALEOR_CLOUD_TOKEN is set."
  ),
  Command.withShortDescription("Log in to Saleor Cloud in your browser.")
);
