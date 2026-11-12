import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { setProgressFormat, withProgress } from "./output.ts";

const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");

afterEach(() => {
  if (stderrTTY) {
    Object.defineProperty(process.stderr, "isTTY", stderrTTY);
  } else {
    Reflect.deleteProperty(process.stderr, "isTTY");
  }

  setProgressFormat("text");
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("runs agent work with plain progress even in a text terminal", async () => {
  vi.stubEnv("AI_AGENT", "1");
  vi.stubEnv("CI", "");
  Object.defineProperty(process.stderr, "isTTY", {
    configurable: true,
    value: true,
  });
  const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  setProgressFormat("text");

  const result = await Effect.runPromise(
    withProgress("Working…", "Done.", Effect.succeed(42))
  );

  expect(result).toBe(42);
  expect(write).toHaveBeenCalledExactlyOnceWith("Working…\n");
});
