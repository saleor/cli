import { Context, Effect } from "effect";
import { askSelect } from "./interaction.ts";
import { writeText } from "./output.ts";

// The composition root supplies command dispatch without coupling modules to main.
export const ContinueInCli = Context.Reference<Effect.Effect<void>>(
  "saleor/ContinueInCli",
  { defaultValue: () => Effect.void }
);

export const navigation = (
  execute: (argv: readonly string[]) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    for (;;) {
      const action = yield* askSelect({
        choices: [
          { label: "Set up a store", value: "init" },
          { label: "View organizations", value: "org" },
          { label: "View projects", value: "project" },
          { label: "View environments", value: "env" },
          { label: "Explore commands", value: "help" },
          { label: "Exit CLI", value: "exit" },
        ],
        message: "What would you like to do next?",
      });

      if (action === "exit") {
        yield* writeText("See you soon!");

        return;
      }

      const argv =
        action === "init" || action === "help" ? [action] : [action, "list"];

      yield* execute([...argv, "--output", "text"]);

      if (process.exitCode === 130) {
        return yield* Effect.interrupt;
      }
    }
  });
