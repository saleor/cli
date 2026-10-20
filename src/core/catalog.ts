import { Effect, Option } from "effect";
import { Command, type Flag, type HelpDoc } from "effect/cli";
import { result, run } from "./command.ts";
import { ERROR_CODES, EXIT_CODE_MEANINGS } from "./errors.ts";
import { BUILT_IN_DESCRIPTIONS } from "./help.ts";
import {
  argumentInfo,
  type CommandSafety,
  commandSafety,
  flagInfo,
  type InputDefault,
} from "./input-info.ts";
import { columns } from "./output.ts";
import { INSTANCE_STATES } from "./target.ts";

type AnyCommand = Command.Command.Any;

export interface CatalogInput {
  readonly aliases: readonly string[];
  readonly choices: readonly string[] | null;
  readonly default: InputDefault | null;
  readonly description: string | null;
  readonly env: string | null;
  readonly name: string;
  readonly required: boolean;
  readonly type: string;
}

export interface CatalogEntry extends CommandSafety {
  readonly arguments: readonly CatalogInput[];
  readonly command: string;
  readonly description: string | null;
  readonly examples: ReadonlyArray<{
    command: string;
    description: string | null;
  }>;
  readonly flags: readonly CatalogInput[];
  // One line, for listings; `description` has the full text.
  readonly summary: string | null;
}

export interface Catalog {
  readonly commands: readonly CatalogEntry[];
  readonly errorCodes: readonly string[];
  readonly exitCodes: typeof EXIT_CODE_MEANINGS;
  readonly globalFlags: readonly CatalogInput[];
  readonly instanceStates: readonly string[];
}

// Effect's Command keeps its parsed flag/argument model behind `buildHelpDoc`, the same
// function `--help` renders from. It is not part of the public API, so this file is the
// only place that touches it.
const helpDocOf = (
  command: AnyCommand,
  path: readonly string[]
): HelpDoc.HelpDoc => {
  if (!("buildHelpDoc" in command)) {
    throw new Error(
      "Effect CLI no longer exposes buildHelpDoc; update the catalogue adapter."
    );
  }

  // SAFETY: pinned Effect CLI commands expose this internal function; the catalogue integration test verifies its return contract.
  const internal = command as AnyCommand & {
    buildHelpDoc: (path: readonly string[]) => HelpDoc.HelpDoc;
  };

  return internal.buildHelpDoc(path);
};

const describe = (value: Option.Option<string>) => Option.getOrNull(value);

// Effect appends the allowed values to a literal flag's description.
const CHOICES = /\s*\(choices: ([^)]*)\)$/;

const flagInput = (flag: HelpDoc.FlagDoc): CatalogInput => {
  const raw = describe(flag.description);
  const choices = raw === null ? undefined : CHOICES.exec(raw)?.[1];
  const info = flagInfo.get(flag.name) ?? {};

  return {
    aliases: flag.aliases.map((alias) => {
      if (alias.startsWith("-")) {
        return alias;
      }

      return alias.length === 1 ? `-${alias}` : `--${alias}`;
    }),
    choices: choices === undefined ? null : choices.split(", "),
    default: info.default ?? (flag.type === "boolean" ? false : null),
    description:
      BUILT_IN_DESCRIPTIONS.get(flag.name) ?? raw?.replace(CHOICES, "") ?? null,
    env: info.env ?? null,
    name: `--${flag.name}`,
    required: flag.required,
    type: choices === undefined ? flag.type : "choice",
  };
};

// Only the flag definition is read; the handler and value type do not matter here.
interface AnyGlobalFlag {
  readonly flag: Flag.Flag<unknown>;
}

// Effect adds global flags to help pages while rendering them, not in `buildHelpDoc`.
// Declaring them as the flags of a throwaway command gives the same help model as
// every other flag.
const globalFlagInputs = (globals: readonly AnyGlobalFlag[]) =>
  helpDocOf(
    Command.make(
      "saleor",
      Object.fromEntries(globals.map((global, i) => [`flag${i}`, global.flag]))
    ),
    ["saleor"]
  ).flags.map(flagInput);

export const buildCatalog = (
  roots: readonly AnyCommand[],
  globals: readonly AnyGlobalFlag[] = [],
  prefix: readonly string[] = ["saleor"]
): Catalog => {
  const commands: CatalogEntry[] = [];

  const visit = (command: AnyCommand, path: readonly string[]) => {
    const children = command.subcommands.flatMap((group) => group.commands);

    if (children.length === 0) {
      const doc = helpDocOf(command, path);
      const name = path.join(" ");

      commands.push({
        ...(commandSafety.get(name) ?? {
          costsMoney: false,
          destructive: false,
          warning: null,
        }),
        arguments: (doc.args ?? []).map((a) => {
          const info = argumentInfo.get(`${name} <${a.name}>`) ?? {};

          return {
            aliases: [],
            choices: null,
            default: info.default ?? null,
            description: describe(a.description),
            env: info.env ?? null,
            name: a.name,
            required: a.required,
            type: a.type,
          };
        }),
        command: name,
        description: command.description ?? null,
        examples: command.examples.map((e) => ({
          command: e.command,
          description: e.description ?? null,
        })),
        flags: doc.flags.map(flagInput),
        summary: command.shortDescription ?? command.description ?? null,
      });
    }

    for (const child of children) {
      visit(child, [...path, child.name]);
    }
  };

  for (const root of roots) {
    visit(root, [...prefix, root.name]);
  }

  return {
    commands,
    errorCodes: ERROR_CODES,
    exitCodes: EXIT_CODE_MEANINGS,
    globalFlags: globalFlagInputs(globals),
    instanceStates: INSTANCE_STATES,
  };
};

export const catalogCommand = (
  roots: () => readonly AnyCommand[],
  globals: readonly AnyGlobalFlag[]
) =>
  Command.make("commands", {}, () =>
    run(
      Effect.sync(() => {
        const catalog = buildCatalog(roots(), globals);

        return result(
          catalog,
          columns(catalog.commands.map((e) => [e.command, e.summary ?? ""]))
        );
      })
    )
  ).pipe(
    Command.withDescription(
      "List every command. With --output json, also lists each command's arguments and flags (with defaults and environment variables), the global flags, exit codes, error codes and instance states, for scripts and coding agents."
    ),
    Command.withShortDescription("List every command.")
  );
