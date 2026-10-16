import { Effect } from "effect";
import { Command } from "effect/cli";
import { result, run } from "../../../core/command.ts";
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
        organizations.map((org) => `${org.slug}  ${org.name}`).join("\n")
      );
    })
  )
).pipe(
  Command.withDescription("List the organizations your account belongs to.")
);

export const orgCommand = Command.make("org").pipe(
  Command.withDescription("Saleor Cloud organizations."),
  Command.withSubcommands([orgList])
);
