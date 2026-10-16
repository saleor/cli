import { Effect } from "effect";
import { Command } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { columns } from "../../../core/output.ts";
import { currentUser } from "../auth/current-user.ts";
import { Session } from "../auth/session.ts";
import { listOrganizations } from "../lookup.ts";

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
