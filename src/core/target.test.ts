import { CANCEL_SYMBOL } from "@clack/prompts";
import { Cause, Effect, Option, Predicate } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Prompts } from "./interaction.ts";
import { ActionContext, type ActionKind, type Answer } from "./invocation.ts";
import { OutputFlag } from "./output.ts";
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

beforeEach(() => {
  for (const key of [
    ...AGENT_VARIABLES,
    "CI",
    "SALEOR_NO_INPUT",
    "SALEOR_ORG",
  ]) {
    vi.stubEnv(key, "");
  }

  for (const stream of [process.stdin, process.stdout]) {
    Object.defineProperty(stream, "isTTY", { configurable: true, value: true });
  }

  vi.spyOn(process.stdout, "write").mockReturnValue(true);
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
});

const org = target({
  env: "SALEOR_ORG",
  identifiedBy: "slug",
  metavar: "slug",
  name: "org",
  noun: "organization",
}).input();

const resolve = (
  supplied: Option.Option<string>,
  options: {
    readonly kind?: ActionKind;
    readonly dryRun?: boolean;
    readonly select?: () => Promise<string | symbol>;
    readonly choices?: readonly string[];
    // The name a person knows a choice by, when it is not its value.
    readonly labels?: Readonly<Record<string, string>>;
  } = {}
) => {
  const answers: Answer[] = [];
  const select = vi.fn(options.select ?? (async () => "acme"));

  const effect = org
    .resolve(supplied, {
      choices: Effect.succeed(
        (options.choices ?? ["acme"]).map((value) => ({
          label: options.labels?.[value] ?? value,
          value,
        }))
      ),
    })
    .pipe(
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(ActionContext, {
        answers,
        dryRun: options.dryRun ?? false,
        force: false,
        kind: options.kind ?? "list",
      }),
      Effect.provideService(Prompts, {
        multiselect: async () => [],
        confirm: async () => true,
        select,
        text: async () => "",
      })
    );

  return { answers, effect, select };
};

it("asks even when there is only one choice, and records the answer", async () => {
  const { answers, effect, select } = resolve(Option.none());

  expect(await Effect.runPromise(effect)).toBe("acme");
  expect(select).toHaveBeenCalledOnce();
  expect(answers).toStrictEqual([{ option: ["--org", "acme"] }]);
});

it("uses the environment variable, except when removing", async () => {
  vi.stubEnv("SALEOR_ORG", "from-env");
  expect(await Effect.runPromise(resolve(Option.none()).effect)).toBe(
    "from-env"
  );

  const removing = resolve(Option.none(), { kind: "remove" });
  expect(await Effect.runPromise(removing.effect)).toBe("acme");
  expect(removing.select).toHaveBeenCalledOnce();
});

it("never asks in a dry run, and lists what could be passed", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(resolve(Option.none(), { dryRun: true }).effect)
  );

  expect(failure.code).toBe("CONTEXT_MISSING");
  expect(failure.suggestion).toContain("--org <slug>");
  expect(failure.details).toMatchObject({ choices: ["acme"] });
});

it("names each choice by what to pass and what a person calls it", async () => {
  const failure = await Effect.runPromise(
    Effect.flip(
      resolve(Option.none(), {
        choices: ["5qvWV4ls", "acme"],
        dryRun: true,
        labels: { "5qvWV4ls": "blank" },
      }).effect
    )
  );

  expect(failure.suggestion).toContain(
    "Choose one of: 5qvWV4ls (blank), acme."
  );
  expect(failure.details).toMatchObject({ choices: ["5qvWV4ls", "acme"] });
});

it("treats cancellation as an interruption", async () => {
  const outcome = await Effect.runPromiseExit(
    resolve(Option.none(), { select: async () => CANCEL_SYMBOL }).effect
  );

  expect(
    Predicate.isTagged(outcome, "Failure") &&
      Cause.hasInterruptsOnly(outcome.cause)
  ).toBe(true);
});

it("runs a detour row, asks again, and never lists it as a choice", async () => {
  const answers: Answer[] = [];
  let signedIn = false;
  const picks = ["\0sign-in", "acme"];
  const select = vi.fn(async () => picks.shift() ?? "");

  const options = {
    choices: Effect.sync(() =>
      signedIn
        ? [{ label: "acme", value: "acme" }]
        : [{ label: "Log in", value: "\0sign-in" }]
    ),
    detours: {
      "\0sign-in": Effect.sync(() => {
        signedIn = true;
      }),
    },
  };

  const run = (dryRun: boolean) =>
    org.resolve(Option.none(), options).pipe(
      Effect.provideService(OutputFlag, Option.some("text")),
      Effect.provideService(ActionContext, {
        answers,
        dryRun,
        force: false,
        kind: "ensure",
      }),
      Effect.provideService(Prompts, {
        multiselect: async () => [],
        confirm: async () => true,
        select,
        text: async () => "",
      })
    );

  signedIn = false;
  const failure = await Effect.runPromise(Effect.flip(run(true)));
  expect(failure.details).toMatchObject({ choices: [] });

  expect(await Effect.runPromise(run(false))).toBe("acme");
  expect(select).toHaveBeenCalledTimes(2);
  expect(answers).toStrictEqual([{ option: ["--org", "acme"] }]);
});
