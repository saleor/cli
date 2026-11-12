import { Context, Effect, Option } from "effect";
import type { Command } from "effect/cli";
import { ExitCode } from "./errors.ts";
import { askSelect } from "./interaction.ts";
import { askThen, canGoBack, withBack } from "./navigation.ts";
import { notice } from "./output.ts";

// Menus are generated from the registered commands, never written by hand, so a new
// command or group appears in them without changes here. There are two:
//
//   home   `saleor` alone: pick a top-level command;
//          the chosen command runs and the CLI exits.
//   group  `saleor env` alone: the group's actions; the chosen one runs and
//          the command finishes. Escape opens its parent.
//
// Escape anywhere in a command opened from a menu brings that menu back.

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

// A line shown above the home menu when there is something to say, such as the
// account commands would act as. Set on the root command by the composition root.
export const MenuStatus = Context.Reference<Effect.Effect<string | undefined>>(
  "saleor/MenuStatus",
  {
    defaultValue: () => Effect.succeed(undefined),
  }
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
    });
  });

// Offers the actions at `path` until one runs to the end.
const browse = (
  root: Command.Command.Any,
  path: readonly string[],
  open: (action: string) => Effect.Effect<void>
) => {
  const children = childrenOf(root, path);

  return askThen(pick(children, path), (action) =>
    action === EXIT
      ? Effect.sync(() => {
          process.exitCode = ExitCode.Success;
        })
      : open(action)
  );
};

export const groupMenu = ({
  root,
  path,
  argv,
  execute,
}: {
  readonly root: Command.Command.Any;
  readonly path: readonly string[];
  readonly argv: readonly string[];
  readonly execute: Execute;
}) =>
  Effect.gen(function* () {
    const menu = browse(root, path, (action) => {
      const separator = argv.indexOf("--");
      const next = [...argv];
      next.splice(separator === -1 ? next.length : separator, 0, action);

      return execute(next);
    });

    // Opened from another menu, Escape returns there. Typed directly, it opens the parent.
    if (yield* canGoBack) {
      return yield* menu;
    }

    if (Option.isNone(yield* withBack(menu))) {
      yield* execute(path.slice(1, -1));
    }
  });

export const homeMenu = (root: Command.Command.Any, execute: Execute) =>
  Effect.gen(function* () {
    const status = yield* Context.get(root.annotations, MenuStatus);

    if (status !== undefined) {
      yield* notice(status);
    }

    yield* browse(root, [root.name], (action) => execute([action]));
  });
