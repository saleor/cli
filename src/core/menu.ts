import { Context, Effect } from "effect";
import type { Command } from "effect/cli";
import { ExitCode } from "./errors.ts";
import { askSelect } from "./interaction.ts";

// Menus are generated from the registered commands, never written by hand, so a new
// command or group appears in them without changes here. There are two:
//
//   home   `saleor` alone, or after logging in: every top-level command, offered
//          again after each one finishes, until Exit.
//   group  `saleor env` alone: the group's actions, once; the chosen one runs and
//          the command finishes.

type Execute = (argv: readonly string[]) => Effect.Effect<void>;

// What a command that hands over to the menu (login) continues with. The runtime
// provides it; inside the menu itself it does nothing, so menus never nest.
export const ContinueInCli = Context.Reference<Effect.Effect<void>>(
  "saleor/ContinueInCli",
  { defaultValue: () => Effect.void }
);

export const EXIT = "\0exit";

export const childrenOf = (
  root: Command.Command.Any,
  path: readonly string[]
) => {
  let group = root;

  for (const segment of path.slice(1)) {
    const child = group.subcommands
      .flatMap((entry) => entry.commands)
      .find((entry) => entry.name === segment || entry.alias === segment);

    if (child === undefined) {
      return [];
    }

    group = child;
  }

  return group.subcommands
    .flatMap((entry) => entry.commands)
    .filter((entry) => !entry.unlisted);
};

const pick = (
  children: readonly Command.Command.Any[],
  path: readonly string[]
) =>
  askSelect({
    choices: [
      ...children.map((child) => ({
        hint: [...path, child.name].join(" "),
        label: child.shortDescription ?? child.description ?? child.name,
        value: child.name,
      })),
      { label: "Exit", value: EXIT },
    ],
    message: `What would you like to do? (${path.join(" ")})`,
  });

export const groupMenu = (
  root: Command.Command.Any,
  path: readonly string[],
  argv: readonly string[],
  execute: Execute
) =>
  Effect.gen(function* () {
    const action = yield* pick(childrenOf(root, path), path);

    if (action === EXIT) {
      process.exitCode = ExitCode.Success;

      return;
    }

    const separator = argv.indexOf("--");
    const next = [...argv];
    next.splice(separator < 0 ? next.length : separator, 0, action);
    yield* execute(next);
  });

export const homeMenu = (root: Command.Command.Any, execute: Execute) =>
  Effect.gen(function* () {
    const path = [root.name];

    for (;;) {
      const action = yield* pick(childrenOf(root, path), path);

      if (action === EXIT) {
        process.exitCode = ExitCode.Success;

        return;
      }

      yield* execute([action]);

      if (process.exitCode === ExitCode.Interrupted) {
        return yield* Effect.interrupt;
      }
    }
  });
