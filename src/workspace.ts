// Composition root for shared user journeys. Modules contribute their setup flags
// and handlers; neither provider imports the other provider.
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "./core/command.ts";
import { fail } from "./core/errors.ts";
import { askSelect, isInteractive } from "./core/interaction.ts";
import { Invocation } from "./core/invocation.ts";
import { cloudInitFlags, initCloud } from "./modules/cloud/commands/init.ts";
import { localSetupFlags, localUpText } from "./modules/local/commands.ts";
import { up } from "./modules/local/lifecycle.ts";

const CLOUD_FLAGS = ["org", "project", "env", "region", "domain-label"];
const LOCAL_FLAGS = ["name", "saleor-version", "sample-data"];

// Which of `names` were typed on the command line. SALEOR_ORG and friends fill the
// same Cloud flags, but an exported variable is not a choice of provider: only flags
// the caller actually passed rule out the other one.
const typed = (argv: readonly string[], names: readonly string[]) =>
  names.filter((name) =>
    argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
  );

const flagList = (names: readonly string[]) =>
  names.map((name) => `--${name}`).join(", ");

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
          const argv = yield* Invocation;
          const cloudFlags = typed(argv, CLOUD_FLAGS);
          const localFlags = typed(argv, LOCAL_FLAGS);

          if (cloudFlags.length > 0 && (flags.local || localFlags.length > 0)) {
            return yield* fail(
              "USAGE_ERROR",
              flags.local
                ? `Cloud flags (${flagList(cloudFlags)}) cannot be used with --local.`
                : `Cloud flags (${flagList(cloudFlags)}) and local flags (${flagList(localFlags)}) cannot be combined.`,
              {
                suggestion:
                  "Choose one: saleor init --local for Docker, or saleor init --org … --project … --env … for Saleor Cloud.",
              }
            );
          }

          // Nothing says which provider: ask a person, default to Cloud otherwise
          // (existing scripts rely on that).
          const local =
            flags.local ||
            localFlags.length > 0 ||
            (cloudFlags.length === 0 &&
              Option.isNone(flags.project) &&
              Option.isNone(flags.env) &&
              (yield* isInteractive) &&
              (yield* askSelect({
                choices: [
                  {
                    hint: "projects and environments in your organization",
                    label: "Saleor Cloud",
                    value: "cloud",
                  },
                  {
                    hint: "Docker on this computer, no login needed",
                    label: "Local",
                    value: "local",
                  },
                ],
                message: "Where should the store run?",
              })) === "local");

          if (local) {
            const data = yield* up({
              name: flags.name,
              saleorVersion: Option.getOrUndefined(flags.saleorVersion),
              sampleData: flags.sampleData,
              timeout: flags.timeout,
            });

            return result<unknown>(data, localUpText(data));
          }

          return yield* initCloud(flags);
        })
      )
  ).pipe(
    Command.withDescription(
      "Create or reuse a working Saleor instance and print how to reach it. Uses Saleor Cloud by default; pass --local for Docker. In a terminal, it asks for anything missing. Does not scaffold application code. Safe to run again after an interruption."
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
