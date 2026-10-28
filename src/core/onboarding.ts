import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Context, Effect } from "effect";
import { defineActions } from "./action.ts";
import { setupCodingAgent } from "./agent-setup.ts";
import { result } from "./command.ts";
import { fail } from "./errors.ts";
import { askSelect, isInteractive } from "./interaction.ts";
import { askThen } from "./navigation.ts";
import {
  onboardingReady,
  onboardingSection,
  welcome,
} from "./onboarding-presentation.ts";
import { notice } from "./output.ts";
import { configDir } from "./secret-store.ts";

const stateFile = () => path.join(configDir(), "onboarding.json");

const completed = () => {
  try {
    return (
      existsSync(stateFile()) &&
      JSON.parse(readFileSync(stateFile(), "utf8")).version === 1
    );
  } catch {
    return false;
  }
};

// Store a completion marker only. Choosing local here does not change the target
// of later commands, and signing out does not restart onboarding.
export const onboard = (
  execute: (argv: readonly string[]) => Effect.Effect<void>,
  force: boolean
) =>
  Effect.gen(function* () {
    if (!force && (yield* Effect.sync(completed))) {
      return true;
    }

    yield* welcome;
    yield* onboardingSection(
      "01",
      "Your workspace",
      "Connect to Saleor Cloud or continue without an account."
    );

    // Escape in any later step returns to this first question.
    const { choice, finished } = yield* askThen(
      askSelect({
        choices: [
          {
            hint: "Log in to your Saleor Cloud account",
            label: "Use Saleor Cloud",
            value: "cloud",
          },
          {
            hint: "Docker or self-hosted. No login needed",
            label: "Local / self-hosted",
            value: "local",
          },
          {
            hint: "Skip login and agent setup",
            label: "Browse commands",
            value: "skip",
          },
        ],
        message: "Where would you like to start?",
      }),
      (picked) =>
        Effect.gen(function* () {
          if (picked === "cloud") {
            yield* execute(["login"]);

            if (process.exitCode !== undefined && process.exitCode !== 0) {
              return { choice: picked, finished: false };
            }
          }

          return {
            choice: picked,
            finished:
              picked === "skip" ||
              (yield* setupCodingAgent(picked === "cloud")),
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

    yield* onboardingReady(choice === "skip");

    return true;
  });

export const Onboarding = Context.Reference<Effect.Effect<void>>(
  "saleor/Onboarding",
  {
    defaultValue: () => Effect.void,
  }
);

export const onboardCommand = defineActions().session({
  description: "Revisit the interactive welcome and Cloud login setup.",
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
