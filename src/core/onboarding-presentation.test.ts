import { stripVTControlCharacters } from "node:util";
import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { welcome } from "./onboarding-presentation.ts";

const properties = ["isTTY", "columns", "rows"] as const;

const original = properties.map(
  (key) => [key, Object.getOwnPropertyDescriptor(process.stdout, key)] as const
);

afterEach(() => {
  for (const [key, descriptor] of original) {
    if (descriptor) {
      Object.defineProperty(process.stdout, key, descriptor);
    } else {
      Reflect.deleteProperty(process.stdout, key);
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const terminal = (columns: number, rows: number) => {
  for (const [key, value] of Object.entries({ columns, isTTY: true, rows })) {
    Object.defineProperty(process.stdout, key, { configurable: true, value });
  }

  vi.stubEnv("TERM", "xterm-256color");
  vi.stubEnv("NO_COLOR", undefined);
  const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  return { stderr, stdout };
};

it("writes the complete welcome once on the prompt stream without clearing or moving the cursor", async () => {
  const { stdout, stderr } = terminal(80, 24);
  await Effect.runPromise(welcome);
  expect(stdout).toHaveBeenCalledOnce();
  expect(stderr).not.toHaveBeenCalled();
  const frame = String(stdout.mock.calls[0]?.[0]);
  expect(stripVTControlCharacters(frame)).toContain("╚══════╝");
  expect(frame).toContain("Welcome to Saleor");
  // Only color/style escapes are allowed: no cursor movement or erase sequences.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Inspect actual ANSI terminal output.
  expect(frame.replace(/\x1b\[[\d;]*m/g, "")).not.toContain("\x1b");
});

it.each([
  [40, 24],
  [80, 16],
])(
  "keeps space for the question in a %i by %i terminal",
  async (columns, rows) => {
    const { stdout } = terminal(columns, rows);
    await Effect.runPromise(welcome);
    const frame = stripVTControlCharacters(String(stdout.mock.calls[0]?.[0]));
    expect(frame).toContain("SALEOR");
    expect(frame).not.toContain("████");
  }
);
