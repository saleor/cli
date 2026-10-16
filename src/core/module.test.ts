import { Command } from "effect/cli";
import { expect, it } from "vitest";
import { type CliModule, collectCommands } from "./module.ts";

const module = (name: string, word: string): CliModule => ({
  commands: [Command.make(word)],
  description: name,
  name,
});

it("rejects conflicting module ownership", () => {
  expect(() =>
    collectCommands([module("cloud", "env"), module("local", "env")])
  ).toThrow('claimed by both "cloud" and "local"');
});

it("reserves core command words", () => {
  expect(() => collectCommands([module("cloud", "commands")])).toThrow(
    'claimed by both "core" and "cloud"'
  );
});
