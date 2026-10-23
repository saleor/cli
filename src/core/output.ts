import { spinner } from "@clack/prompts";
import { Effect, Exit, Option } from "effect";
import { Flag, GlobalFlag } from "effect/cli";
import type { CliFailure } from "./errors.ts";
import { catalogInfo } from "./input-info.ts";

export type OutputFormat = "text" | "json";

catalogInfo.flag("output", { env: "SALEOR_OUTPUT" });

export const OutputFlag = GlobalFlag.Setting("output")({
  flag: Flag.Literals("output", ["text", "json"]).pipe(
    Flag.withDescription(
      "Output format: text for people, json for scripts and coding agents. Defaults to text in a terminal, json otherwise. --json is short for --output json."
    ),
    Flag.optional
  ),
});

// Registered for help and the command catalog; runtime expands the shorthand.
export const AgentFlag = GlobalFlag.Setting("agent")({
  flag: Flag.Boolean("agent").pipe(
    Flag.withDescription(
      "Shorthand for --json --no-input. Structured results without prompts."
    ),
    Flag.withDefault(false)
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
  "CODEX_THREAD_ID",
  "CODEX_SESSION_ID",
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

export const useColors = (stream: NodeJS.WriteStream = process.stdout) =>
  stream.isTTY === true &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb";

// People get the message and what to do next; the error code is for programs and is
// only in the json output (and the exit code).
export const writeTextFailure = (failure: CliFailure) =>
  Effect.sync(() => {
    const colors = useColors(process.stderr);
    const mark = colors ? "\x1b[31m✗\x1b[0m " : "✗ ";

    const lines = [
      `${failure.code === "CANCELLED" ? "" : mark}${failure.message}`,
    ];

    if (failure.suggestion) {
      lines.push(...failure.suggestion.split("\n").map((line) => `  ${line}`));
    }

    process.stderr.write(`${lines.join("\n")}\n`);
  });

// Aligned columns for list output. The first row is the header.
export const columns = (
  rows: readonly (readonly (string | null | undefined)[])[]
) => {
  const cells = rows.map((row) => row.map((cell) => cell ?? ""));

  const widths = cells[0]?.map((_, i) =>
    Math.max(...cells.map((row) => row[i]?.length ?? 0))
  );

  return cells
    .map((row) =>
      row
        .map((cell, i) =>
          i === row.length - 1 ? cell : cell.padEnd(widths?.[i] ?? 0)
        )
        .join("   ")
        .trimEnd()
    )
    .join("\n");
};

// The format this process renders in, set once by the runtime so progress written from
// anywhere follows it without depending on the output flag service.
let progressFormat: OutputFormat = "text";

export const setProgressFormat = (format: OutputFormat) => {
  progressFormat = format;
};

// Progress and instructions for the human (device codes, waiting notices) always go to
// stderr, so stdout carries exactly one result document in json mode. In json mode
// each one is a JSON line, `{"event": "progress", "message": …}`, and `fields` add
// structured data, such as the login link, for programs that act on it.
export const notice = (
  message: string,
  fields: Readonly<Record<string, string | number | null>> = {}
) =>
  Effect.sync(() =>
    process.stderr.write(
      progressFormat === "json"
        ? `${JSON.stringify({ event: "progress", message, ...fields })}\n`
        : `${message}\n`
    )
  );

export const withProgress = <A, E, R>(
  message: string,
  completed: string,
  effect: Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    if (
      progressFormat !== "text" ||
      !process.stderr.isTTY ||
      process.env.CI ||
      detectAgent() !== undefined
    ) {
      yield* notice(message);

      return yield* effect;
    }

    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const indicator = spinner({
          indicator: "timer",
          output: process.stderr,
        });

        indicator.start(message);

        return indicator;
      }),
      () => effect,
      (indicator, exit) =>
        Effect.sync(() => {
          if (Exit.isSuccess(exit)) {
            indicator.stop(completed);
          } else {
            indicator.clear();
          }
        })
    );
  });
