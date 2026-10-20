import { Effect } from "effect";
import { Command } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { columns } from "../../../core/output.ts";
import { listOrganizations } from "../lookup.ts";

const orgList = Command.make("list", {}, () =>
  run(
    Effect.gen(function* () {
      const organizations = (yield* listOrganizations).map((org) => ({
        name: org.name,
        slug: org.slug,
      }));

      return result(
        organizations,
        organizations.length === 0
          ? "You do not belong to any organization yet. Create one at https://cloud.saleor.io"
          : columns([
              ["SLUG", "NAME"],
              ...organizations.map((org) => [org.slug, org.name]),
            ])
      );
    })
  )
).pipe(
  Command.withDescription("List the organizations your account belongs to.")
);

export const orgCommand = Command.make("org").pipe(
  Command.withDescription("List the Saleor Cloud organizations you belong to."),
  Command.withShortDescription("Manage organizations."),
  Command.withSubcommands([orgList])
);
