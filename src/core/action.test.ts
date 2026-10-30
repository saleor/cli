import { Effect, Layer, Option } from "effect";
import { Command } from "effect/cli";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { absent, defineActions, type TargetRef } from "./action.ts";
import { result } from "./command.ts";
import { NoInputFlag, Prompts } from "./interaction.ts";
import { OutputFlag } from "./output.ts";
import { createCliRuntime } from "./runtime.ts";
import { target } from "./target.ts";

const AGENT_VARIABLES = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
  "GEMINI_CLI",
  "OPENCODE",
  "AMP_CURRENT_THREAD_ID",
];

const tty = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY")
);

let stdout: string[];
let stderr: string[];
let applied: string[];

beforeEach(() => {
  for (const key of [
    ...AGENT_VARIABLES,
    "CI",
    "SALEOR_NO_INPUT",
    "SALEOR_OUTPUT",
  ]) {
    vi.stubEnv(key, "");
  }

  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  }

  stdout = [];
  applied = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));

    return true;
  });
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));

    return true;
  });
});

afterEach(() => {
  for (const [index, stream] of [process.stdin, process.stdout].entries()) {
    const descriptor = tty[index];

    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      Reflect.deleteProperty(stream, "isTTY");
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = 0;
});

const thing = target({
  identifiedBy: "name",
  metavar: "name",
  name: "name",
  noun: "thing",
}).input({ creates: true });

const ref = (name: string): TargetRef => ({
  id: null,
  name,
  scope: {},
  type: "thing",
});

const actions = defineActions();

const make = actions.ensure({
  description: "Make a thing.",
  inputs: { name: thing },
  name: "make",
  plan: (input) =>
    Effect.gen(function* () {
      const name = yield* thing.resolve(input.name, {
        choices: Effect.succeed([{ label: "old", value: "old" }]),
        create: { label: "New", prompt: "Name" },
      });

      return {
        action: name === "old" ? ("reuse" as const) : ("create" as const),
        apply: Effect.sync(() => {
          applied.push(name);

          return result({ created: name !== "old", name }, "");
        }),
        details: {},
        notice: name === "billed" ? "It may be billed." : undefined,
        risk: null,
        state: name === "old" ? ("exists" as const) : ("absent" as const),
        target: ref(name),
      };
    }),
  summary: "Make a thing.",
});

const drop = actions.remove({
  description: "Drop a thing.",
  inputs: { name: thing },
  name: "drop",
  plan: (input) =>
    Effect.succeed(
      Option.isNone(input.name)
        ? absent(ref("missing"))
        : {
            action: "delete" as const,
            apply: Effect.sync(() => {
              applied.push("dropped");

              return {};
            }),
            details: {},
            risk: "It is gone for good.",
            state: "exists" as const,
            target: ref(input.name.value),
          }
    ),
  risk: "Drops things.",
  summary: "Drop a thing.",
});

const run = async (
  argv: readonly string[],
  answers: { confirm?: boolean; select?: string; text?: string } = {}
) => {
  const confirm = vi.fn(async () => answers.confirm ?? true);

  const execute = createCliRuntime(
    Command.make("saleor").pipe(
      Command.withSubcommands([make, drop]),
      Command.withGlobalFlags([OutputFlag, NoInputFlag])
    ),
    { services: Layer.empty, version: "1" }
  );

  return await Effect.runPromise(
    execute(argv).pipe(
      Effect.provideService(Prompts, {
        confirm,
        select: async () => answers.select ?? "\0new",
        text: async () => answers.text ?? "fresh",
      })
    )
  ).then(() => ({ confirm, json: () => JSON.parse(stdout.join("")) }));
};

it("refuses a deletion without a terminal, and names the flag that confirms it", async () => {
  const { json } = await run(["drop", "--name", "x", "--json"]);

  expect(json().error.code).toBe("CONFIRMATION_REQUIRED");
  expect(json().error.suggestion).toContain(
    "saleor drop --name x --json --force"
  );
  expect(applied).toStrictEqual([]);
  expect(process.exitCode).toBe(1);
});

it("deletes with --force, or after a yes at a terminal", async () => {
  await run(["drop", "--name", "x", "--json", "--force"]);
  const { confirm } = await run(["drop", "--name", "x"]);

  expect(confirm).toHaveBeenCalledOnce();
  expect(applied).toStrictEqual(["dropped", "dropped"]);
});

it("tells a notice once before creating, without asking", async () => {
  const { confirm } = await run(["make", "--name", "billed", "--json"]);

  expect(confirm).not.toHaveBeenCalled();
  expect(applied).toStrictEqual(["billed"]);
  expect(stderr.join("")).toContain("It may be billed.");
});

it("puts a notice in the review instead, when there is one", async () => {
  stderr = [];
  await run(["make"], { text: "billed" });

  expect(stderr.join("").match(/It may be billed\./g)).toHaveLength(1);
  expect(stderr.join("")).toContain("Note: It may be billed.");
});

it("shows what answers will create before creating it, and records them for a rerun", async () => {
  const { confirm } = await run(["make"], { text: "fresh" });

  expect(confirm).toHaveBeenCalledExactlyOnceWith({
    back: false,
    initialValue: true,
    message: "Continue?",
  });
  expect(applied).toStrictEqual(["fresh"]);
  expect(stdout.join("")).toContain("saleor make --name fresh");
});

it("reuses without asking anything more", async () => {
  const { confirm } = await run(["make"], { select: "old" });

  expect(confirm).not.toHaveBeenCalled();
  expect(applied).toStrictEqual(["old"]);
});

it("previews without applying, confirming or asking", async () => {
  const { confirm, json } = await run([
    "make",
    "--name",
    "billed",
    "--dry-run",
    "--json",
  ]);

  expect(json().data).toMatchObject({
    action: "create",
    dryRun: true,
    notice: "It may be billed.",
    warning: null,
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(applied).toStrictEqual([]);
});

it("removes what exists after confirmation, and succeeds on what does not", async () => {
  await run(["drop", "--name", "x"], { confirm: false });
  expect(applied).toStrictEqual([]);
  expect(process.exitCode).toBe(1);

  stdout = [];
  const { json } = await run(["drop", "--json"]);

  expect(json().data).toMatchObject({ action: "none", existed: false });
  expect(process.exitCode).toBe(0);
});
