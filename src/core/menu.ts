import { Context, Effect } from "effect";
import type { Command } from "effect/cli";
import { ExitCode } from "./errors.ts";
import { askSelect } from "./interaction.ts";

// Menus are generated from the registered commands, never written by hand, so a new
// command or group appears in them without changes here. There are two:
//
//   home   `saleor` alone: pick a top-level command once;
//          the chosen command runs and the CLI exits.
//   group  `saleor env` alone: the group's actions, once; the chosen one runs and
//          the command finishes. Back opens its parent; Exit returns to the shell.

type Execute = (argv: readonly string[]) => Effect.Effect<void>;

// Session commands remain available explicitly, outside exploratory navigation.
export const HideFromMenu = Context.Reference<boolean>("saleor/HideFromMenu", {
  defaultValue: () => false,
});

// Commands can depend on local context when offered in exploratory navigation.
export const MenuAvailable = Context.Reference<Effect.Effect<boolean>>(
  "saleor/MenuAvailable",
  {
    defaultValue: () => Effect.succeed(true),
  }
);

export const BACK = "\0back";
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
  Effect.gen(function* () {
    const choices = yield* Effect.forEach(children, (child) =>
      Effect.gen(function* () {
        if (
          Context.get(child.annotations, HideFromMenu) ||
          !(yield* Context.get(child.annotations, MenuAvailable))
        ) {
          return [];
        }

        return [
          {
            hint: [...path, child.name].join(" "),
            label: child.shortDescription ?? child.description ?? child.name,
            value: child.name,
          },
        ];
      })
    );

    return yield* askSelect({
      choices: choices.flat(),
      message: `What would you like to do? (${path.join(" ")})`,
      navigation: path.length > 1 ? { back: BACK } : {},
    });
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

    if (action === BACK) {
      yield* execute(path.slice(1, -1));

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

    const action = yield* pick(childrenOf(root, path), path);

    if (action === EXIT) {
      process.exitCode = ExitCode.Success;

      return;
    }

    yield* execute([action]);
  });
