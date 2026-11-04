import { Option } from "effect";
import type { Command } from "effect/cli";
import { expect, it } from "vitest";
import { root } from "../main.ts";
import { actionMeta } from "./action.ts";
import { buildCatalog } from "./catalog.ts";
import type { ActionKind } from "./invocation.ts";

// The conventions every command follows, checked over the real command tree so a new
// command cannot opt out of them by accident. See docs/design/commands.md.
const { commands } = buildCatalog(
  root.subcommands.flatMap((group) => group.commands)
);

// ── Grammar ──────────────────────────────────────────────────────────────
// `saleor <noun> <verb> [<env>] [flags]`, or a top-level verb about the CLI itself.
// Verbs come from a closed list per kind, so the same word always means the same
// kind of change, and a new verb is a decision made here, not in passing.

const VERBS: Record<ActionKind, readonly string[]> = {
  ensure: [
    "init",
    "add",
    "start",
    "create",
    "use",
    "deploy",
    "pull",
    "edit",
    "reinstall",
  ],
  list: ["list", "status", "diff"],
  remove: ["stop", "remove"],
  session: [
    "login",
    "logout",
    "onboard",
    "commands",
    "validate",
    "guide",
    "call",
    "listen",
  ],
};

// Verbs that undo each other: a group with one has the other.
const PAIRS = [
  ["add", "remove"],
  ["start", "stop"],
] as const;

const wordsOf = (command: string) => command.split(" ").slice(1);

it.each(commands)("$command is a verb, or a noun and a verb", (entry) => {
  const words = wordsOf(entry.command);

  expect(words.length).toBeGreaterThanOrEqual(1);
  expect(words.length).toBeLessThanOrEqual(2);
  expect(VERBS[entry.kind]).toContain(words.at(-1));
});

it("pairs verbs that undo each other within a group", () => {
  const groups = new Map<string, Set<string>>();

  for (const entry of commands) {
    const [group, verb] = wordsOf(entry.command);

    if (group !== undefined && verb !== undefined) {
      groups.set(group, new Set([...(groups.get(group) ?? []), verb]));
    }
  }

  for (const [group, verbs] of groups) {
    for (const [one, other] of PAIRS) {
      expect(verbs.has(one), `${group} ${other}`).toBe(verbs.has(other));
    }
  }
});

// A store is named one way everywhere: `<env>`, the word after the command, which
// takes a name from saleor.yml or a ref. Only `init`, which creates the first store
// of a new project, names stores with provider flags.
it.each(commands.filter((entry) => entry.command !== "saleor init"))(
  "$command names a store only as <env>",
  (entry) => {
    expect(
      entry.flags
        .map((flag) => flag.name)
        .filter((name) => ["--instance", "--name", "--env"].includes(name))
    ).toStrictEqual([]);

    const positional = entry.arguments.map((argument) => argument.name);

    // A store is the first and only word; a new name or a description is not a store.
    expect(positional.length).toBeLessThanOrEqual(1);
  }
);

it.each(
  commands.filter((entry) =>
    entry.arguments.some((argument) => argument.name === "env")
  )
)("$command reads <env> from SALEOR_ENV unless it removes", (entry) => {
  const env = entry.arguments.find((argument) => argument.name === "env");

  expect(env?.env ?? null).toBe(entry.kind === "remove" ? null : "SALEOR_ENV");
});

// ── Kinds ────────────────────────────────────────────────────────────────

it.each(commands)(
  "$command takes targets as input, never as required words",
  (entry) => {
    expect(
      entry.arguments.filter((argument) => argument.required)
    ).toStrictEqual([]);
  }
);

it.each(commands)("$command publishes the flags its kind implies", (entry) => {
  const flags = new Set(entry.flags.map((flag) => flag.name));
  const changes = entry.kind === "ensure" || entry.kind === "remove";

  expect(flags.has("--dry-run")).toBe(changes);
  expect(flags.has("--force")).toBe(entry.destructive);
  // Only changes can lose data, and only those that declare a risk do: deleting, or a
  // pull that replaces the file. Stopping keeps data, so it asks nothing.
  expect(!entry.destructive || changes).toBe(true);
  expect(entry.warning !== null).toBe(entry.destructive);
});

// ── Targets ──────────────────────────────────────────────────────────────
// What a command picks from what the CLI can list (a store, an app, a project) is a
// target, so it is asked for wherever a person can be asked (see core/target.ts). An
// input spelled like a target but declared as a plain flag would fail instead.

const leaves = (
  command: Command.Command.Any,
  path: string
): readonly (readonly [string, Command.Command.Any])[] => {
  const children = command.subcommands.flatMap((group) => group.commands);

  return children.length === 0
    ? [[path, command]]
    : children.flatMap((child) => leaves(child, `${path} ${child.name}`));
};

const inputs = root.subcommands
  .flatMap((group) => group.commands)
  .flatMap((command) => leaves(command, `saleor ${command.name}`))
  .flatMap(([path, command]) =>
    Option.match(actionMeta(command), {
      onNone: () => [],
      onSome: (meta) =>
        [...meta.inputs].map(([spelled, info]) => ({ info, path, spelled })),
    })
  );

const targetSpellings = new Set(
  inputs
    .filter((input) => input.info.target !== undefined)
    .map((input) => input.spelled)
);

it.each(inputs.filter((input) => targetSpellings.has(input.spelled)))(
  "$spelled of $path is a target",
  (input) => {
    expect(input.info.target).toBeDefined();
  }
);

it.each(commands.filter((entry) => entry.kind === "remove"))(
  "$command never reads its targets from the environment",
  (entry) => {
    expect(
      [...entry.flags, ...entry.arguments].filter((input) => input.env !== null)
    ).toStrictEqual([]);
  }
);
