// Composition root for shared user journeys. Modules contribute their setup flags
// and handlers; neither provider imports the other provider.
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "./core/command.ts";
import { fail } from "./core/errors.ts";
import { cloudInitFlags, initCloud } from "./modules/cloud/commands/init.ts";
import { localSetupFlags, localUpText } from "./modules/local/commands.ts";
import { up } from "./modules/local/lifecycle.ts";

export const workspaceCommands = () => {
  const init = Command.make(
    "init",
    {
      ...cloudInitFlags,
      ...localSetupFlags,
      local: Flag.Boolean("local").pipe(
        Flag.withDescription(
          "Set up Saleor locally with Docker instead of Saleor Cloud."
        ),
        Flag.withDefault(false)
      ),
    },
    (flags) =>
      run(
        Effect.gen(function* () {
          if (flags.local) {
            if (
              [
                flags.org,
                flags.project,
                flags.env,
                flags.region,
                flags.domainLabel,
              ].some(Option.isSome)
            ) {
              return yield* fail(
                "USAGE_ERROR",
                "Cloud flags (--org, --project, --env, --region, --domain-label) cannot be used with --local."
              );
            }

            const data = yield* up({
              name: flags.name,
              saleorVersion: Option.getOrUndefined(flags.saleorVersion),
              sampleData: flags.sampleData,
              timeout: flags.timeout,
            });

            return result<unknown>(data, localUpText(data));
          }

          if (
            flags.name !== "default" ||
            flags.sampleData ||
            Option.isSome(flags.saleorVersion)
          ) {
            return yield* fail(
              "USAGE_ERROR",
              "Local flags (--name, --saleor-version, --sample-data) require --local."
            );
          }

          return yield* initCloud(flags);
        })
      )
  ).pipe(
    Command.withDescription(
      "Create or reuse a working Saleor instance and print how to reach it. Uses Saleor Cloud by default; pass --local for Docker. Does not scaffold application code. Safe to run again after an interruption."
    ),
    Command.withShortDescription(
      "Set up a Saleor store in Cloud or locally with --local."
    ),
    Command.withExamples([
      {
        command: "saleor init --local",
        description: "Start a local store with Docker",
      },
      {
        command: "saleor init --org acme --project my-store --env dev",
        description: "Create a Cloud project and sandbox",
      },
    ])
  );

  return [init];
};
