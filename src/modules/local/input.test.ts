import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CANCEL_SYMBOL } from "@clack/prompts";
import { Cause, Effect, Option, Predicate } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prompts } from "../../core/interaction.ts";
import { OutputFlag } from "../../core/output.ts";
import { resolveLocalName } from "./input.ts";

let directory: string;

const tty = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY")
);

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "saleor-input-"));
  vi.stubEnv("SALEOR_CONFIG_DIR", directory);
  vi.stubEnv("CI", "");
  vi.stubEnv("SALEOR_NO_INPUT", "");

  for (const key of [
    "AI_AGENT",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CURSOR_AGENT",
    "CODEX_SANDBOX",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "OPENCODE",
    "AMP_CURRENT_THREAD_ID",
    "GEMINI_CLI",
  ]) {
    vi.stubEnv(key, "");
  }

  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  }

  mkdirSync(path.join(directory, "local/default"), { recursive: true });
  writeFileSync(path.join(directory, "local/default/instance.json"), "{}");
});

afterEach(() => {
  [process.stdin, process.stdout].forEach((stream, index) => {
    const descriptor = tty[index];

    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      Reflect.deleteProperty(stream, "isTTY");
    }
  });
  rmSync(directory, { force: true, recursive: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("asks even when only the default instance exists", async () => {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const select = vi.fn(async () => "default");

  const name = await Effect.runPromise(
    resolveLocalName(Option.none(), "existing").pipe(
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(Prompts, {
        confirm: async () => true,
        select,
        text: async () => "",
      })
    )
  );

  expect(name).toBe("default");
  expect(select).toHaveBeenCalledExactlyOnceWith({
    choices: [{ label: "default", value: "default" }],
    message: "Which local instance?",
  });
});

it("cancellation interrupts target resolution", async () => {
  const outcome = await Effect.runPromiseExit(
    resolveLocalName(Option.none(), "existing").pipe(
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(Prompts, {
        confirm: async () => true,
        select: async () => CANCEL_SYMBOL,
        text: async () => "",
      })
    )
  );

  expect(outcome._tag).toBe("Failure");

  if (Predicate.isTagged(outcome, "Failure")) {
    expect(Cause.hasInterruptsOnly(outcome.cause)).toBe(true);
  }
});

it("dry runs refuse missing targets even in a terminal", async () => {
  const result = await Effect.runPromise(
    resolveLocalName(Option.none(), "existing", true).pipe(
      Effect.flip,
      Effect.provideService(OutputFlag, Option.some("text"))
    )
  );

  expect(result.code).toBe("CONTEXT_MISSING");
});
