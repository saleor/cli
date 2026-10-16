// Composition root for shared user journeys. Modules contribute their setup flags
// and handlers; neither provider imports the other provider.
import path from "node:path";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "./core/command.ts";
import { fail } from "./core/errors.ts";
import {
  resolveTarget,
  type TargetProvider,
  targetData,
  writeTargetRef,
} from "./core/target.ts";
import { cloudInitFlags, initCloud } from "./modules/cloud/commands/init.ts";
import { cloudLinkFlags, linkCloud } from "./modules/cloud/commands/link.ts";
import { localSetupFlags, localUpText } from "./modules/local/commands.ts";
import { up } from "./modules/local/lifecycle.ts";

export const workspaceCommands = (
  providers: ReadonlyMap<string, TargetProvider>
) => {
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
              link: !flags.noLink,
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

          if (Option.isNone(flags.project) || Option.isNone(flags.env)) {
            return yield* fail(
              "USAGE_ERROR",
              "Cloud setup requires --project <name> and --env <name>.",
              { suggestion: "For a local store, run: saleor init --local" }
            );
          }

          return yield* initCloud({
            ...flags,
            env: flags.env.value,
            project: flags.project.value,
          });
        })
      )
  ).pipe(
    Command.withDescription(
      "Create or reuse a working Saleor instance and link this directory. Uses Saleor Cloud by default; pass --local for Docker. Does not scaffold application code. Safe to run again after an interruption."
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

  const link = Command.make(
    "link",
    {
      ...cloudLinkFlags,
      ref: Argument.String("ref").pipe(
        Argument.withDescription(
          "Target: local[:name] or cloud:<org>/<project>/<environment>."
        ),
        Argument.optional
      ),
    },
    (flags) =>
      run(
        Effect.gen(function* () {
          if (Option.isNone(flags.ref)) {
            return yield* linkCloud(flags);
          }

          if ([flags.org, flags.project, flags.env].some(Option.isSome)) {
            return yield* fail(
              "USAGE_ERROR",
              "Pass either a target ref or --org/--project/--env, together they are ambiguous."
            );
          }

          const target = yield* resolveTarget(providers, flags.ref);
          const file = yield* writeTargetRef(target.ref);

          return result(
            { file, ...targetData(target) },
            `✓ This directory now uses ${target.ref}. Saved in ${path.relative(process.cwd(), file)}.`
          );
        })
      )
  ).pipe(
    Command.withDescription(
      "Choose the Saleor instance for this directory. Pass a target ref, or use --org/--project/--env as Cloud shorthand. Saved in .saleor/link.json without secrets."
    ),
    Command.withShortDescription(
      "Link this directory to a Cloud or local Saleor instance."
    )
  );

  return [init, link];
};
