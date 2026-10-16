import { Effect, Option } from "effect";
import { Command, type HelpDoc } from "effect/cli";
import { result, run } from "./command.ts";
import { columns } from "./output.ts";

type AnyCommand = Command.Command.Any;

export interface CatalogEntry {
  readonly arguments: ReadonlyArray<{
    name: string;
    type: string;
    required: boolean;
    description: string | null;
  }>;
  readonly command: string;
  readonly description: string | null;
  readonly examples: ReadonlyArray<{
    command: string;
    description: string | null;
  }>;
  readonly flags: ReadonlyArray<{
    name: string;
    type: string;
    required: boolean;
    description: string | null;
  }>;
  // One line, for listings; `description` has the full text.
  readonly summary: string | null;
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

export const buildCatalog = (
  roots: readonly AnyCommand[],
  prefix: readonly string[] = ["saleor"]
) => {
  const entries: CatalogEntry[] = [];

  const visit = (command: AnyCommand, path: readonly string[]) => {
    const children = command.subcommands.flatMap((group) => group.commands);

    if (children.length === 0) {
      const doc = helpDocOf(command, path);
      entries.push({
        arguments: (doc.args ?? []).map((a) => ({
          description: describe(a.description),
          name: a.name,
          required: a.required,
          type: a.type,
        })),
        command: path.join(" "),
        description: command.description ?? null,
        examples: command.examples.map((e) => ({
          command: e.command,
          description: e.description ?? null,
        })),
        flags: doc.flags.map((f) => ({
          description: describe(f.description),
          name: `--${f.name}`,
          required: f.required,
          type: f.type,
        })),
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

  return entries;
};

export const catalogCommand = (roots: () => readonly AnyCommand[]) =>
  Command.make("commands", {}, () =>
    run(
      Effect.sync(() => {
        const entries = buildCatalog(roots());

        return result(
          entries,
          columns(entries.map((e) => [e.command, e.summary ?? ""]))
        );
      })
    )
  ).pipe(
    Command.withDescription(
      "List every command. With --output json, also lists each command's arguments and flags, for scripts and coding agents."
    ),
    Command.withShortDescription("List every command.")
  );
