import type { Command } from "effect/cli";

// A module is a unit of code ownership (Cloud today; Storefront, Configurator later).
// It owns one or more top-level command words. The words are what users and agents
// type; the module is how the code is organised and grouped in help.
export interface CliModule {
  readonly commands: readonly Command.Command.Any[];
  readonly description: string;
  readonly name: string;
}

// Commands that belong to the CLI itself rather than to any module.
export const RESERVED_WORDS = [
  "commands",
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
