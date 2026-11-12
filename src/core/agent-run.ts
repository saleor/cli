import { Effect, Option, Schema } from "effect";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { detectCodingAgents } from "./agents.ts";
import { fail } from "./errors.ts";

// Running a coding agent installed on this computer without tools: it gets a prompt
// on standard input and only answers with text. Used to draft store configuration;
// the agent never sees a token, and its answer is checked before anything uses it.

// A coding agent the CLI can run this way.
export interface HeadlessAgent {
  readonly id: "claude" | "codex";
  readonly label: string;
}

// What a coding agent's run says about itself, so a person sees which model drafted
// and can open the session to read the whole conversation.
export interface AgentRun {
  readonly agent: HeadlessAgent["id"];
  readonly costUsd: number | undefined;
  readonly durationMs: number;
  readonly id: string | undefined;
  readonly model: string | undefined;
  // The command that opens the session in the agent.
  readonly open: string | undefined;
  readonly tokens: number | undefined;
}

export interface AgentAnswer {
  readonly session: AgentRun;
  readonly text: string;
}

const ClaudeResult = Schema.Struct({
  duration_ms: Schema.optional(Schema.Number),
  modelUsage: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ outputTokens: Schema.optional(Schema.Number) })
    )
  ),
  result: Schema.String,
  session_id: Schema.optional(Schema.String),
  total_cost_usd: Schema.optional(Schema.Number),
});

// The model that wrote the answer: the one with the most output (Claude Code also
// uses a small model for housekeeping).
const mainModel = (usage: (typeof ClaudeResult.Type)["modelUsage"]) =>
  Object.entries(usage ?? {})
    .sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0))
    .at(0)?.[0];

const CodexEvent = Schema.Struct({
  item: Schema.optional(
    Schema.Struct({ text: Schema.optional(Schema.String), type: Schema.String })
  ),
  thread_id: Schema.optional(Schema.String),
  type: Schema.String,
  usage: Schema.optional(
    Schema.Struct({
      input_tokens: Schema.optional(Schema.Number),
      output_tokens: Schema.optional(Schema.Number),
    })
  ),
});

const decodeClaude = Schema.decodeUnknownOption(
  Schema.fromJsonString(ClaudeResult)
);

const decodeCodexEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(CodexEvent)
);

const MODEL_LINE = /^model\s*=\s*"([^"]+)"/m;

// Codex does not report its model; its configuration names it.
const codexModel = () => {
  const file = path.join(
    process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
    "config.toml"
  );

  return existsSync(file)
    ? MODEL_LINE.exec(readFileSync(file, "utf-8"))?.[1]
    : undefined;
};

const unreadable = (agent: string) =>
  fail(
    "STORE_ERROR",
    `The coding agent (${agent}) answered in a form the CLI cannot read.`,
    {
      suggestion: "Update it, or try the other agent with --with.",
    }
  );

const TIMEOUT_MS = 5 * 60_000;

const run = (binary: string, args: readonly string[], prompt: string) =>
  Effect.tryPromise({
    catch: (error) =>
      fail(
        "STORE_ERROR",
        `The coding agent (${binary}) did not answer: ${error instanceof Error ? error.message : String(error)}`,
        { suggestion: "Try again, or describe the store differently." }
      ),
    try: async (signal) =>
      await new Promise<string>((resolve, reject) => {
        const child = spawn(binary, args, {
          signal,
          stdio: ["pipe", "pipe", "pipe"],
          timeout: TIMEOUT_MS,
        });

        let out = "";
        let err = "";

        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          err += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve(out);
          } else {
            // The last line of its errors; a timeout or a silent exit says so.
            const said = err.trim().split("\n").at(-1) ?? "";

            const stopped =
              code === null ? "it was stopped" : `exit code ${code}`;

            reject(new Error(said === "" ? stopped : said));
          }
        });
        child.stdin.end(prompt);
      }),
  });

const RUNNERS = {
  // Fixes continue the same session, so one session holds the whole draft.
  claude: (prompt: string, resume: string | undefined) =>
    Effect.gen(function* () {
      const started = Date.now();

      const out = yield* run(
        "claude",
        [
          "-p",
          "--output-format",
          "json",
          "--tools",
          "",
          ...(resume === undefined ? [] : ["--resume", resume]),
          ...(process.env.SALEOR_AGENT_MODEL
            ? ["--model", process.env.SALEOR_AGENT_MODEL]
            : []),
        ],
        prompt
      );

      const parsed = decodeClaude(out.trim());

      if (Option.isNone(parsed)) {
        return yield* unreadable("claude");
      }

      const { value } = parsed;

      return {
        session: {
          agent: "claude",
          costUsd: value.total_cost_usd,
          durationMs: value.duration_ms ?? Date.now() - started,
          id: value.session_id,
          model: mainModel(value.modelUsage),
          open:
            value.session_id === undefined
              ? undefined
              : `claude --resume ${value.session_id}`,
          tokens: undefined,
        },
        text: value.result,
      } satisfies AgentAnswer;
    }),
  codex: (prompt: string, resume: string | undefined) =>
    Effect.gen(function* () {
      const started = Date.now();

      const out = yield* run(
        "codex",
        [
          "exec",
          ...(resume === undefined ? [] : ["resume", resume]),
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--json",
        ],
        prompt
      );

      const events = out
        .split("\n")
        .flatMap((line) => Option.toArray(decodeCodexEvent(line.trim())));

      const thread =
        events.find((event) => event.thread_id !== undefined)?.thread_id ??
        resume;

      const text = events.findLast(
        (event) => event.item?.type === "agent_message"
      )?.item?.text;

      const tokens = events
        .filter((event) => event.usage !== undefined)
        .reduce(
          (sum, event) =>
            sum +
            (event.usage?.input_tokens ?? 0) +
            (event.usage?.output_tokens ?? 0),
          0
        );

      if (text === undefined) {
        return yield* unreadable("codex");
      }

      return {
        session: {
          agent: "codex",
          costUsd: undefined,
          durationMs: Date.now() - started,
          id: thread,
          model: codexModel(),
          open: thread === undefined ? undefined : `codex resume ${thread}`,
          tokens: tokens > 0 ? tokens : undefined,
        },
        text,
      } satisfies AgentAnswer;
    }),
} as const;

const shortId = (id: string) =>
  id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;

// One line about a run: "Claude Code · claude-opus-5-5 · 41 s · $0.21 · session 97353874…4058".
export const agentRunLine = (agent: HeadlessAgent, session: AgentRun) =>
  [
    agent.label,
    session.model ?? "default model",
    `${Math.round(session.durationMs / 1000)} s`,
    ...(session.costUsd === undefined
      ? []
      : [`$${session.costUsd.toFixed(2)}`]),
    ...(session.tokens === undefined
      ? []
      : [`${Math.round(session.tokens / 1000)}k tokens`]),
    ...(session.id === undefined ? [] : [`session ${shortId(session.id)}`]),
  ].join(" · ");

export const installedHeadlessAgents = (): readonly HeadlessAgent[] =>
  detectCodingAgents()
    .filter(
      (agent): agent is typeof agent & { id: HeadlessAgent["id"] } =>
        agent.detected && (agent.id === "claude" || agent.id === "codex")
    )
    .map((agent) => ({ id: agent.id, label: agent.label }));

export const HEADLESS_AGENTS: Readonly<Record<HeadlessAgent["id"], string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

// Asks the agent; with `resume`, continues that session, so fixes stay in one place.
export const askAgent = (
  agent: HeadlessAgent,
  prompt: string,
  resume: string | undefined
) => RUNNERS[agent.id](prompt, resume);
