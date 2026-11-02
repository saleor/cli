import { Context, Effect, Layer } from "effect";
import { Command } from "effect/cli";
import { expect, it } from "vitest";
import { collectCommands, defineModule } from "./module.ts";

const module = (name: string, word: string) =>
  defineModule({
    commands: [Command.make(word)],
    description: name,
    layer: Layer.empty,
    name,
  });

it("rejects conflicting module ownership", () => {
  expect(() =>
    collectCommands([module("cloud", "store"), module("local", "store")])
  ).toThrow('claimed by both "cloud" and "local"');
});

it.each(["commands", "env", "init"])("reserves the core word %s", (word) => {
  expect(() => collectCommands([module("cloud", word)])).toThrow(
    'claimed by both "core" and "cloud"'
  );
});

it("requires a module's layer to build what its commands use", () => {
  class Clock extends Context.Service<Clock, { readonly now: number }>()(
    "test/Clock"
  ) {}

  const command = Command.make("time", {}, () =>
    Effect.asVoid(Effect.service(Clock))
  );

  const complete = defineModule({
    commands: [command],
    description: "time",
    layer: Layer.succeed(Clock, { now: 0 }),
    name: "time",
  });

  defineModule({
    commands: [command],
    description: "time",
    // @ts-expect-error The layer does not provide Clock.
    layer: Layer.empty,
    name: "time",
  });

  expect(complete.commands).toHaveLength(1);
});
