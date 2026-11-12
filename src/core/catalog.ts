import { Effect, Option } from "effect";
import { Command, type Flag, type HelpDoc } from "effect/cli";
import { actionMeta, defineActions } from "./action.ts";
import { result } from "./command.ts";
import { ERROR_CODES, ERRORS, EXIT_CODE_MEANINGS } from "./errors.ts";
import { BUILT_IN_DESCRIPTIONS } from "./help.ts";
import type { InputDefault, InputInfo } from "./inputs.ts";
import { STORE_STATES } from "./store.ts";
import type { ActionKind } from "./invocation.ts";
import { columns } from "./output.ts";

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

export interface CatalogEntry {
  readonly arguments: readonly CatalogInput[];
  readonly command: string;
  readonly description: string | null;
  readonly destructive: boolean;
  readonly examples: readonly {
    command: string;
    description: string | null;
  }[];
  readonly flags: readonly CatalogInput[];
  readonly kind: ActionKind;
  // One line, for listings; `description` has the full text.
  readonly summary: string | null;
  readonly warning: string | null;
}

export interface Catalog {
  readonly commands: readonly CatalogEntry[];
  readonly errorCodes: readonly {
    readonly code: string;
    readonly exitCode: number;
    readonly meaning: string;
    readonly retry: boolean;
  }[];
  readonly exitCodes: typeof EXIT_CODE_MEANINGS;
  readonly globalFlags: readonly CatalogInput[];
  readonly instanceStates: readonly string[];
}

// A global flag and what the catalogue publishes about it.
export interface GlobalInput {
  readonly global: { readonly flag: Flag.Flag<unknown> };
  readonly info: InputInfo;
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Effect exposes this internal method; catalogue contract tests verify its return shape.
  const internal = command as AnyCommand & {
    buildHelpDoc: (path: readonly string[]) => HelpDoc.HelpDoc;
  };

  return internal.buildHelpDoc(path);
};

const describe = (value: Option.Option<string>) => Option.getOrNull(value);

// Effect appends the allowed values to a literal flag's description.
const CHOICES = /\s*\(choices: ([^)]*)\)$/;

const flagInput = (
  flag: HelpDoc.FlagDoc,
  info: InputInfo | undefined
): CatalogInput => {
  const raw = describe(flag.description);
  const choices = raw === null ? undefined : CHOICES.exec(raw)?.[1];

  return {
    aliases: flag.aliases.map((alias) => {
      if (alias.startsWith("-")) {
        return alias;
      }

      return alias.length === 1 ? `-${alias}` : `--${alias}`;
    }),
    choices: choices === undefined ? null : choices.split(", "),
    default: info?.default ?? (flag.type === "boolean" ? false : null),
    description:
      BUILT_IN_DESCRIPTIONS.get(flag.name) ?? raw?.replace(CHOICES, "") ?? null,
    env: info?.env ?? null,
    name: `--${flag.name}`,
    required: flag.required,
    type: choices === undefined ? flag.type : "choice",
  };
};

// Effect adds global flags to help pages while rendering them, not in `buildHelpDoc`.
// Declaring them as the flags of a throwaway command gives the same help model as
// every other flag.
const globalFlagInputs = (globals: readonly GlobalInput[]) =>
  globals.flatMap(({ global, info }) =>
    helpDocOf(Command.make("saleor", { flag: global.flag }), [
      "saleor",
    ]).flags.map((flag) => flagInput(flag, info))
  );

export const buildCatalog = (
  roots: readonly AnyCommand[],
  globals: readonly GlobalInput[] = [],
  prefix: readonly string[] = ["saleor"]
): Catalog => {
  const commands: CatalogEntry[] = [];

  const visit = (command: AnyCommand, path: readonly string[]) => {
    const children = command.subcommands.flatMap((group) => group.commands);

    if (children.length === 0) {
      const name = path.join(" ");
      const meta = actionMeta(command);

      // Every command is an action of a declared kind; see core/action.ts.
      if (Option.isNone(meta)) {
        throw new Error(
          `"${name}" is not defined with defineActions, so it has no kind or safety metadata.`
        );
      }

      const { inputs, ...safety } = meta.value;
      const doc = helpDocOf(command, path);

      commands.push({
        ...safety,
        arguments: (doc.args ?? []).map((a) => {
          const info = inputs.get(`<${a.name}>`);

          return {
            aliases: [],
            choices: null,
            default: info?.default ?? null,
            description: describe(a.description),
            env: info?.env ?? null,
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
        flags: doc.flags.map((flag) =>
          flagInput(flag, inputs.get(`--${flag.name}`))
        ),
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
    errorCodes: ERROR_CODES.map((code) => ({ code, ...ERRORS[code] })),
    exitCodes: EXIT_CODE_MEANINGS,
    globalFlags: globalFlagInputs(globals),
    instanceStates: STORE_STATES,
  };
};

export const catalogCommand = (
  roots: () => readonly AnyCommand[],
  globals: readonly GlobalInput[]
) =>
  defineActions().session({
    description:
      "List every command. With --output json, also lists each command's kind, safety, arguments and flags (with defaults and environment variables), the global flags, exit codes, error codes and instance states, for scripts and coding agents.",
    inputs: {},
    name: "commands",
    run: () =>
      Effect.sync(() => {
        const catalog = buildCatalog(roots(), globals);

        return result(
          catalog,
          columns(catalog.commands.map((e) => [e.command, e.summary ?? ""]))
        );
      }),
    summary: "List every command.",
  });
