import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { Prompts } from "./interaction.ts";
import { navigation } from "./navigation.ts";

afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
});

it("keeps offering actions after a command finishes or fails until exit", async () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const answers = ["org", "init", "help", "exit"];
  const calls: (readonly string[])[] = [];
  const select = vi.fn(async () => answers.shift() ?? "exit");

  await Effect.runPromise(
    navigation((argv) =>
      Effect.sync(() => {
        calls.push(argv);
        process.exitCode = 1;
      })
    ).pipe(
      Effect.provideService(Prompts, {
        confirm: async () => true,
        select,
        text: async () => "",
      })
    )
  );

  expect(calls).toEqual([
    ["org", "list", "--output", "text"],
    ["init", "--output", "text"],
    ["help", "--output", "text"],
  ]);
  expect(select).toHaveBeenCalledTimes(4);
});

it("stops the menu when an action is interrupted", async () => {
  const select = vi.fn(async () => "init");

  const outcome = await Effect.runPromiseExit(
    navigation(() =>
      Effect.sync(() => {
        process.exitCode = 130;
      })
    ).pipe(
      Effect.provideService(Prompts, {
        confirm: async () => true,
        select,
        text: async () => "",
      })
    )
  );

  expect(outcome._tag).toBe("Failure");
  expect(select).toHaveBeenCalledTimes(1);
});
