// What Effect keeps inside closures and cannot report back: a flag's default value and
// the environment variable that fills it. Whoever defines a flag records them here, next
// to the definition, and `saleor commands --json` publishes them; a test checks them
// against the help text. This file imports nothing, so any module can record into it.
export type InputDefault = string | number | boolean;

export interface InputInfo {
  readonly default?: InputDefault;
  readonly env?: string;
}

export const flagInfo = new Map<string, InputInfo>();
export const argumentInfo = new Map<string, InputInfo>();

export interface CommandSafety {
  readonly costsMoney: boolean;
  readonly destructive: boolean;
  readonly warning: string | null;
}

export const commandSafety = new Map<string, CommandSafety>();

export const catalogInfo = {
  // Positional arguments differ per command, so they are keyed by the command too.
  argument: (command: string, name: string, info: InputInfo) => {
    argumentInfo.set(`${command} <${name}>`, info);
  },
  command: (command: string, safety: CommandSafety) => {
    commandSafety.set(command, safety);
  },
  // Flags mean the same in every command that takes them.
  flag: (name: string, info: InputInfo) => {
    flagInfo.set(name, info);
  },
};
