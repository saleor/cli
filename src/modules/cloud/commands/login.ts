import { Effect, Option } from "effect";
import { defineActions } from "../../../core/action.ts";
import { result } from "../../../core/command.ts";
import { option } from "../../../core/inputs.ts";
import { isInteractive } from "../../../core/interaction.ts";
import { ContinueInCli } from "../../../core/menu.ts";
import { notice, useColors, writeText } from "../../../core/output.ts";
import { currentUser } from "../auth/current-user.ts";
import { DEVICE_CLIENT_ID } from "../auth/device-grant.ts";
import { deviceLogin } from "../auth/device-login.ts";
import { Session } from "../auth/session.ts";

export const login = defineActions().session({
  description:
    "Log in to Saleor Cloud. Opens your browser to approve the login; in a terminal, then continues with the home menu. Not needed when SALEOR_CLOUD_TOKEN is set.",
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
      const continued = yield* isInteractive;

      // A person is welcomed and carries on from the home menu; the result below is
      // for scripts, and for a person it was said here already.
      if (continued) {
        const title = `✦  Welcome${user.name ? `, ${user.name}` : ""}!`;

        yield* writeText(
          [
            "",
            useColors() ? `\x1b[1;35m${title}\x1b[0m` : title,
            "",
            `✓  You're signed in as ${user.email}.`,
            "",
          ].join("\n")
        );
        yield* yield* ContinueInCli;
      }

      let text = `✓ Logged in as ${user.email}.`;

      if (continued) {
        text = "";
      } else if (status.source === "env") {
        text = `SALEOR_CLOUD_TOKEN is set, so no login is needed. Using it as ${user.email}.`;
      }

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
});
