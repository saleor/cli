import type { Layer } from "effect";
import type { Command, GlobalFlag } from "effect/cli";
import type { TargetProvider } from "./target.ts";

// A module is a unit of code ownership (Cloud today; Storefront, Configurator later).
// It owns one or more top-level command words, and the layer that builds the services
// those commands run with. The words are what users and agents type; the module is how
// the code is organised.
export interface CliModule {
  readonly commands: readonly Command.Command.Any[];
  readonly description: string;
  // Erased here; `defineModule` checked it against the commands' requirements.
  readonly layer: Layer.Layer<never>;
  readonly name: string;
  readonly target?: TargetProvider;
}

// Services the root command provides to every module: its global flags.
export type CoreServices = GlobalFlag.Setting.Identifier<"output">;

// Any command, keeping only what it requires to run.
// biome-ignore lint/suspicious/noExplicitAny: Command names are invariant; a module holds commands of any name.
type ModuleCommand<R> = Command.Command<any, never, unknown, unknown, R>;

// Ties a module's commands to its layer at compile time: if a command needs a service
// the layer does not build, this does not type-check. Registration itself erases the
// types (Effect's subcommand list is `Command.Any`), so this is where they are checked.
export const defineModule = <R>(module: {
  readonly target?: TargetProvider;
  readonly commands: readonly ModuleCommand<R>[];
  readonly description: string;
  readonly layer: Layer.Layer<NoInfer<Exclude<R, CoreServices>>>;
  readonly name: string;
}): CliModule => module;

// Commands that belong to the CLI itself rather than to any module.
export const RESERVED_WORDS = [
  "commands",
  "init",
  "link",
  "help",
  "version",
  "completions",
] as const;

export const collectCommands = (modules: readonly CliModule[]) => {
  const owners = new Map<string, string>(
    RESERVED_WORDS.map((word) => [word, "core"])
  );

  const commands: CliModule["commands"][number][] = [];

  for (const module of modules) {
    for (const command of module.commands) {
      for (const word of [command.name, command.alias].filter(
        (w): w is string => w !== undefined
      )) {
        const owner = owners.get(word);

        if (owner !== undefined) {
          throw new Error(
            `Top-level command "${word}" is claimed by both "${owner}" and "${module.name}"`
          );
        }

        owners.set(word, module.name);
      }

      commands.push(command);
    }
  }

  return commands;
};
