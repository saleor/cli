import { Effect, Exit, Option } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { storeFrom } from "../../core/store.ts";
import { Prompts } from "../../core/interaction.ts";
import { ActionContext, type Answer } from "../../core/invocation.ts";
import { OutputFlag } from "../../core/output.ts";
import { canAskForApp, pickApp } from "./pick-app.ts";

// Without --app, a person at a terminal picks the app from the store's list.

const tty = [process.stdin, process.stdout].map((stream) =>
  Object.getOwnPropertyDescriptor(stream, "isTTY")
);

const terminal = (isTTY: boolean) => {
  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", {
      configurable: true,
      value: isTTY,
    });
  }
};

beforeEach(() => {
  // Agents' markers turn questions off; this is a person at a terminal.
  for (const key of [
    "AI_AGENT",
    "AMP_CURRENT_THREAD_ID",
    "CI",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CODEX_SANDBOX",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "CURSOR_AGENT",
    "GEMINI_CLI",
    "OPENCODE",
    "SALEOR_NO_INPUT",
  ]) {
    vi.stubEnv(key, "");
  }

  terminal(true);
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  for (const [index, stream] of [process.stdin, process.stdout].entries()) {
    const descriptor = tty[index];

    if (descriptor === undefined) {
      Reflect.deleteProperty(stream, "isTTY");
    } else {
      Object.defineProperty(stream, "isTTY", descriptor);
    }
  }

  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const client = {
  store: storeFrom({
    dashboardUrl: "https://example.test/dashboard/",
    graphqlUrl: "http://127.0.0.1:1/graphql/",
    kind: "cloud",
    name: "dev",
    ref: "cloud:acme/env1",
    saleorVersion: "3.23.0",
    state: "running",
  }),
  token: "store.secret",
};

const app = (id: string, name: string | null) => ({
  id,
  identifier: `${id}.identifier`,
  isActive: true,
  manifestUrl: null,
  name,
  type: null,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, typeof OutputFlag.Identifier>,
  answer = ""
) => {
  const select = vi.fn(async () => answer);
  const answers: Answer[] = [];

  const exit = Effect.runPromiseExit(
    effect.pipe(
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(ActionContext, {
        answers,
        dryRun: false,
        force: false,
        kind: "remove",
      }),
      Effect.provideService(Prompts, {
        confirm: async () => true,
        multiselect: async () => [],
        select,
        text: async () => "",
      })
    )
  );

  return { answers, exit, select };
};

it("lists the store's apps and remembers the pick as --app", async () => {
  const { answers, exit, select } = run(
    pickApp(client, [app("A1", "Loyalty"), app("A2", null)], "uninstall"),
    "A2"
  );

  expect(await exit).toStrictEqual(Exit.succeed("A2"));
  expect(select).toHaveBeenCalledWith(
    expect.objectContaining({
      choices: [
        { hint: "A1.identifier", label: "Loyalty", value: "A1" },
        { hint: "A2.identifier", label: "A2", value: "A2" },
      ],
      message: "Which app do you want to uninstall?",
    })
  );
  expect(answers).toStrictEqual([{ option: ["--app", "A2"] }]);
});

it("says so when the store has no apps to pick from", async () => {
  const { exit, select } = run(pickApp(client, [], "reinstall"));
  const outcome = await exit;

  expect(select).not.toHaveBeenCalled();
  expect(Exit.isFailure(outcome)).toBe(true);
  expect(JSON.stringify(outcome)).toContain("NOT_FOUND");
});

it("fails at once without --app when nobody can be asked", async () => {
  terminal(false);

  const outcome = await run(canAskForApp(Option.none(), "uninstall")).exit;

  expect(JSON.stringify(outcome)).toContain("CONTEXT_MISSING");
  expect(
    Exit.isSuccess(await run(canAskForApp(Option.some("A1"), "uninstall")).exit)
  ).toBe(true);
});
