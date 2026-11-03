import { Context, Effect, Option, Schema } from "effect";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineActions } from "./action.ts";
import { setupCodingAgent } from "./agent-setup.ts";
import { result } from "./command.ts";
import { fail } from "./errors.ts";
import { askConfirm, askSelect, isInteractive } from "./interaction.ts";
import { askThen } from "./navigation.ts";
import {
  onboardingReady,
  onboardingSection,
  welcome,
} from "./onboarding-presentation.ts";
import { notice } from "./output.ts";
import { findProject } from "./project.ts";
import {
  type OnboardingPath,
  selectorOf,
  type SetupProvider,
} from "./setup.ts";
import { directoryState } from "./scaffold.ts";
import { configDir } from "./secret-store.ts";

const stateFile = () => path.join(configDir(), "onboarding.json");

const completed = () => {
  try {
    return (
      existsSync(stateFile()) &&
      Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Number }))(
        JSON.parse(readFileSync(stateFile(), "utf-8"))
      ).version === 1
    );
  } catch {
    return false;
  }
};

// The current folder as a person reads it, with ~ for their home.
const here = () => {
  const cwd = process.cwd();
  const home = os.homedir();

  return cwd === home || cwd.startsWith(`${home}${path.sep}`)
    ? `~${cwd.slice(home.length)}`
    : cwd;
};

// The last step: set up a store now, where the first step said it should run. Not
// offered inside a project, which has its stores. `init` makes the project here when
// this folder is empty, else a folder in it.
const offerStore = (path: Path) =>
  Effect.gen(function* () {
    if (Option.isSome(findProject())) {
      return false;
    }

    yield* onboardingSection("03", "Your store", path.store);

    const where =
      directoryState(process.cwd()) === "used"
        ? `a new folder in ${here()}`
        : here();

    return yield* askConfirm(
      `Set up a store now? It takes a few minutes; the project goes in ${where}.`
    );
  });

// A place to run stores, as onboarding offers it: what its setup provider says, and
// the `init` that sets up a store there.
type Path = OnboardingPath & {
  readonly init: readonly string[];
  readonly value: string;
};

// What onboarding reads of a setup provider.
type Offered = Pick<SetupProvider<unknown>, "flag" | "name" | "onboarding">;

const pathsOf = (providers: readonly Offered[]): readonly Path[] =>
  providers.flatMap((provider) =>
    provider.onboarding === undefined
      ? []
      : [
          {
            ...provider.onboarding,
            init: ["init", `--${selectorOf(provider)}`],
            value: provider.name,
          },
        ]
  );

const SKIP = "skip";

const failed = () => process.exitCode !== undefined && process.exitCode !== 0;

// Store a completion marker only. The place picked here does not change the target
// of later commands, and logging out does not restart onboarding.
export const onboard = (
  execute: (argv: readonly string[]) => Effect.Effect<void>,
  force: boolean,
  providers: readonly Offered[]
) =>
  Effect.gen(function* () {
    const paths = pathsOf(providers);

    if (!force && (yield* Effect.sync(completed))) {
      return true;
    }

    yield* welcome;
    yield* onboardingSection(
      "01",
      "Your workspace",
      "Choose where your stores run."
    );

    // Escape in any later step returns to this first question.
    const { finished, path, store } = yield* askThen(
      askSelect({
        choices: [
          ...paths.map((each) => ({
            hint: each.hint,
            label: each.label,
            value: each.value,
          })),
          {
            hint: "Skip login and agent setup",
            label: "Browse commands",
            value: SKIP,
          },
        ],
        message: "Where would you like to start?",
      }),
      (picked) =>
        Effect.gen(function* () {
          const chosen = paths.find((each) => each.value === picked);

          if (chosen === undefined) {
            return { finished: true, path: undefined, store: false };
          }

          if (chosen.first !== undefined) {
            yield* execute(chosen.first);

            if (failed()) {
              return { finished: false, path: chosen, store: false };
            }
          }

          const finished = yield* setupCodingAgent(chosen.agentTool);

          return {
            finished,
            path: chosen,
            store: finished && (yield* offerStore(chosen)),
          };
        })
    );

    if (!finished) {
      return false;
    }

    const saved = yield* Effect.try(() => {
      mkdirSync(configDir(), { mode: 0o700, recursive: true });
      writeFileSync(stateFile(), '{"version":1}\n', { mode: 0o600 });
    }).pipe(Effect.isSuccess);

    if (!saved) {
      yield* notice(
        "Could not save onboarding completion. You may see setup again next time."
      );
    }

    // Onboarding is done either way: a store that fails to set up is retried with
    // `saleor init`, not by onboarding again. Its result ends the run, as from the menu.
    if (store && path !== undefined) {
      yield* execute(path.init);

      return false;
    }

    yield* onboardingReady(path === undefined);

    return true;
  });

export const Onboarding = Context.Reference<Effect.Effect<void>>(
  "saleor/Onboarding",
  {
    defaultValue: () => Effect.void,
  }
);

export const onboardCommand = defineActions().session({
  description:
    "Revisit the interactive welcome: where your stores run, and coding agent setup.",
  inputs: {},
  name: "onboard",
  run: () =>
    Effect.gen(function* () {
      if (!(yield* isInteractive)) {
        return yield* fail(
          "CONTEXT_MISSING",
          "Onboarding needs an interactive terminal.",
          {
            suggestion: "Use saleor login or saleor init directly in scripts.",
          }
        );
      }

      yield* yield* Onboarding;

      if (process.exitCode !== undefined && process.exitCode !== 0) {
        return yield* fail(
          "CANCELLED",
          "Onboarding did not finish. Run saleor onboard to retry."
        );
      }

      return result({ completed: true }, "");
    }),
  summary: "Revisit onboarding.",
});
