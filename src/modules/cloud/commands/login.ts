import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { defineActions } from "../../../core/action.ts";
import { result } from "../../../core/command.ts";
import { option } from "../../../core/inputs.ts";
import { HideFromMenu } from "../../../core/menu.ts";
import { notice } from "../../../core/output.ts";
import { currentUser } from "../auth/current-user.ts";
import { DEVICE_CLIENT_ID } from "../auth/device-grant.ts";
import { deviceLogin } from "../auth/device-login.ts";
import { Session } from "../auth/session.ts";

export const login = defineActions()
  .session({
    description:
      "Log in to Saleor Cloud. Opens your browser to approve the login. Not needed when SALEOR_CLOUD_TOKEN is set.",
    inputs: {
      noBrowser: option.boolean(
        "no-browser",
        "Only print the login link; do not open a browser."
      ),
    },
    name: "login",
    run: (input) =>
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
          yield* deviceLogin(!input.noBrowser);
        }

        const { label: _, ...user } = yield* currentUser;
        const status = yield* session.status;

        const text =
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
          text
        );
      }),
    summary: "Log in to Saleor Cloud in your browser.",
  })
  .pipe(Command.annotate(HideFromMenu, true));
