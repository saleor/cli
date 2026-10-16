import { Effect } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { openBrowser } from "../../../core/interaction.ts";
import { columns, notice } from "../../../core/output.ts";
import { CloudApi, orDescribe } from "../api/client.ts";
import { retrieveUserWithOnboardingInfo } from "../api/generated.ts";
import {
  DEVICE_CLIENT_ID,
  pollForTokens,
  requestDeviceCode,
} from "../auth/device-grant.ts";
import { Session } from "../auth/session.ts";
import { listOrganizations } from "../lookup.ts";

const currentUser = Effect.gen(function* () {
  const api = yield* CloudApi;
  const user = yield* orDescribe(api.call(retrieveUserWithOnboardingInfo));

  const name =
    [user.first_name, user.last_name].filter(Boolean).join(" ") || null;

  return {
    email: user.email,
    label: name === null ? user.email : `${name} <${user.email}>`,
    name,
  };
});

// Reuses a still-valid pending code, so an agent that was interrupted while the person
// was approving does not invalidate the link it already showed them.
const deviceLogin = (openInBrowser: boolean) =>
  Effect.gen(function* () {
    const session = yield* Session;
    const pending = yield* session.pendingGrant;

    const grant =
      pending !== undefined && pending.expiresAt - 30_000 > Date.now()
        ? pending
        : yield* requestDeviceCode;

    if (grant !== pending) {
      yield* session.savePendingGrant(grant);
    }

    const url = grant.verificationUriComplete ?? grant.verificationUri;
    const opened = openInBrowser ? yield* openBrowser(url) : false;
    yield* notice(
      [
        opened
          ? "To log in, approve the request in the browser window that just opened:"
          : "To log in, open this link in your browser and approve the request:",
        `  ${url}`,
        `  Check that the page shows the code ${grant.userCode}.`,
        "Waiting for approval… (Ctrl+C to cancel)",
      ].join("\n")
    );

    const tokens = yield* pollForTokens(grant);
    yield* session.saveLogin(tokens);
    yield* session.clearPendingGrant;
  });

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

export const whoami = Command.make("whoami", {}, () =>
  run(
    Effect.gen(function* () {
      const session = yield* Session;
      const { label, ...user } = yield* currentUser;
      const organizations = yield* listOrganizations;
      const status = yield* session.status;

      const data = {
        ...user,
        credentialSource: status.source,
        organizations: organizations.map((org) => ({
          name: org.name,
          slug: org.slug,
        })),
      };

      const storedIn =
        status.store === "keyring" ? "the system keychain" : "a local file";

      const via =
        status.source === "env"
          ? "using SALEOR_CLOUD_TOKEN"
          : `login saved in ${storedIn}`;

      return result(
        data,
        [
          `Logged in as ${label} (${via}).`,
          "",
          data.organizations.length === 0
            ? "You do not belong to any organization yet. Create one at https://cloud.saleor.io"
            : columns([
                ["ORGANIZATION", "NAME"],
                ...data.organizations.map((org) => [org.slug, org.name]),
              ]),
        ].join("\n")
      );
    })
  )
).pipe(
  Command.withDescription(
    "Show who you are logged in as and which organizations you belong to."
  ),
  Command.withShortDescription("Show who you are logged in as.")
);
