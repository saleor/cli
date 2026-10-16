import { Effect, Option } from "effect";
import { Flag, GlobalFlag } from "effect/cli";
import type { CliFailure } from "./errors.ts";

export type OutputFormat = "text" | "json";

export const OutputFlag = GlobalFlag.Setting("output")({
  flag: Flag.Literals("output", ["text", "json"]).pipe(
    Flag.withDescription(
      "Output format. Defaults to text in a terminal and json for pipes and coding agents."
    ),
    Flag.optional
  ),
});

// Environment variables that coding agents set in the shells they spawn. An agent that
// allocates a real terminal would otherwise get human output it then has to parse.
const AGENT_ENV_VARS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "GEMINI_CLI",
  "OPENCODE",
  "AMP_CURRENT_THREAD_ID",
] as const;

export const detectAgent = (
  env: NodeJS.ProcessEnv = process.env
): string | undefined =>
  AGENT_ENV_VARS.find((name) => {
    const value = env[name]?.trim().toLowerCase();

    return (
      value !== undefined && value !== "" && value !== "0" && value !== "false"
    );
  });

export const resolveOutputFormat = (
  explicit: Option.Option<OutputFormat>,
  env: NodeJS.ProcessEnv = process.env,
  stdoutIsTTY: boolean = process.stdout.isTTY === true
): OutputFormat => {
  if (Option.isSome(explicit)) {
    return explicit.value;
  }

  const fromEnv = env.SALEOR_OUTPUT;

  if (fromEnv === "text" || fromEnv === "json") {
    return fromEnv;
  }

  if (detectAgent(env) !== undefined) {
    return "json";
  }

  return stdoutIsTTY ? "text" : "json";
};

// Peeks at argv before parsing so failures raised by the parser itself (unknown flags,
// missing arguments) are still rendered in the format the caller asked for.
export const outputFormatFromArgv = (
  argv: readonly string[]
): Option.Option<OutputFormat> => {
  for (const [i, arg] of argv.entries()) {
    let value: string | undefined;

    if (arg === "--output") {
      value = argv[i + 1];
    } else if (arg.startsWith("--output=")) {
      value = arg.slice(9);
    }

    if (value === "text" || value === "json") {
      return Option.some(value);
    }
  }

  return Option.none();
};

export const currentOutputFormat = Effect.gen(function* () {
  return resolveOutputFormat(yield* OutputFlag);
});

export type Envelope<A> =
  | { readonly ok: true; readonly data: A }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly suggestion: string | null;
        readonly retry: boolean;
        readonly details?: unknown;
      };
    };

export const successEnvelope = <A>(data: A): Envelope<A> => ({
  data,
  ok: true,
});

export const failureEnvelope = (failure: CliFailure): Envelope<never> => {
  const error: Extract<Envelope<never>, { ok: false }>["error"] = {
    code: failure.code,
    message: failure.message,
    retry: failure.retry ?? false,
    suggestion: failure.suggestion ?? null,
  };

  return failure.details === undefined
    ? { error, ok: false }
    : { error: { ...error, details: failure.details }, ok: false };
};

export const writeJson = (envelope: Envelope<unknown>) =>
  Effect.sync(() =>
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
  );

export const writeText = (text: string) =>
  Effect.sync(() => {
    if (text.length > 0) {
      process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
    }
  });

export const writeTextFailure = (failure: CliFailure) =>
  Effect.sync(() => {
    const lines = [`✗ ${failure.message}`, `  code: ${failure.code}`];

    if (failure.suggestion) {
      lines.push(`  ${failure.suggestion}`);
    }

    process.stderr.write(`${lines.join("\n")}\n`);
  });

// Progress and instructions for the human (device codes, waiting notices) always go to
// stderr, so stdout carries exactly one result document in json mode.
export const notice = (message: string) =>
  Effect.sync(() => process.stderr.write(`${message}\n`));
