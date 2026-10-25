import { expect, it } from "vitest";
import { root } from "../main.ts";
import { buildCatalog } from "./catalog.ts";

// The conventions every command follows, checked over the real command tree so a new
// command cannot opt out of them by accident. See docs/design/commands.md.
const { commands } = buildCatalog(
  root.subcommands.flatMap((group) => group.commands)
);

it.each(commands)(
  "$command takes targets as input, never as required words",
  (entry) => {
    expect(entry.arguments.filter((argument) => argument.required)).toEqual([]);
  }
);

it.each(commands)("$command publishes the flags its kind implies", (entry) => {
  const flags = entry.flags.map((flag) => flag.name);
  const changes = entry.kind === "ensure" || entry.kind === "remove";

  expect(flags.includes("--dry-run")).toBe(changes);
  expect(flags.includes("--force")).toBe(entry.destructive);
  expect(entry.destructive).toBe(entry.kind === "remove");
  expect(entry.warning !== null).toBe(entry.destructive);
});

it.each(commands.filter((entry) => entry.kind === "remove"))(
  "$command never reads its targets from the environment",
  (entry) => {
    expect(
      [...entry.flags, ...entry.arguments].filter((input) => input.env !== null)
    ).toEqual([]);
  }
);
