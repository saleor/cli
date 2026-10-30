import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Option, Result, Schema } from "effect";
import { stringify } from "yaml";
import { detectCodingAgents } from "../../core/agents.ts";
import { fail } from "../../core/errors.ts";
import {
  askConfirm,
  askSelect,
  askText,
  type Choice,
  isInteractive,
} from "../../core/interaction.ts";
import { notice } from "../../core/output.ts";
import {
  type Answers,
  fromAnswers,
  KINDS,
  type KindKey,
  REGIONS,
  type RegionKey,
} from "./blocks.ts";
import { type Document, parseYamlDocument } from "./document.ts";
import { validateFile } from "./engine.ts";
import { mergeConfig, orderDocumentLike } from "./merge.ts";

// Who writes a configuration from plain words. An agent running the CLI writes it
// itself, guided by `saleor config guide`. A person gets it written by a coding agent
// installed on this computer, run without tools: it only answers with YAML, never
// sees a token, and the CLI checks the answer before anyone deploys it. Without one,
// a few questions pick building blocks (blocks.ts).

type Config = Document;

// ── The guide, shared by agents running the CLI and agents it runs ──────

const EXAMPLE = stringify(
  fromAnswers({ kind: "apparel", region: "us", samples: true })
);

export const GUIDE = `# Writing a Saleor configuration (config.yml)

A config.yml describes a Saleor store's structure for Saleor Configurator: channels,
warehouses, shipping, attributes, product types, categories, collections, products
and menus. The CLI checks it with \`saleor config validate\` and applies it with
\`saleor config deploy\`. Deploys create and update; they never delete.

## Rules the checks enforce

- Attributes are defined once, in \`productAttributes\`, and referenced from product
  types as \`- attribute: <Name>\` under \`productAttributes\` or \`variantAttributes\`.
  Never define attributes inline inside a product type.
- Attribute \`inputType\` is one of DROPDOWN, MULTISELECT, PLAIN_TEXT, RICH_TEXT,
  NUMERIC, BOOLEAN, DATE, SWATCH. DROPDOWN, MULTISELECT and SWATCH list \`values\`.
- An attribute is either a product attribute or a variant attribute of a type, not
  both. Variant attributes are what customers choose between (size, color).
- Channels: \`name\`, \`slug\`, \`currencyCode\` (ISO 4217), \`defaultCountry\`
  (ISO 3166 alpha-2), \`isActive\`.
- Warehouses: \`name\`, \`slug\`, \`address\` with \`streetAddress1\`, \`city\`,
  \`postalCode\`, \`country\`, and \`countryArea\` (state or province code) for
  countries that need one, such as US (e.g. CO) and CA (e.g. ON); \`shippingZones\`
  lists zone names.
- Shipping zones: \`name\`, \`countries\`, \`warehouses\` (slugs), \`channels\`
  (slugs), \`shippingMethods\` with \`name\`, \`type: PRICE\` and \`channelListings\`
  of \`{ channel, price }\`.
- Categories: \`name\`, \`slug\`, optional \`subcategories\` of the same shape.
- Products: \`name\`, \`slug\`, \`productType\` (a type's name), \`category\` (a
  category slug), \`attributes\` (attribute name → one of its values),
  \`channelListings\`, and \`variants\` with a unique \`sku\`, variant
  \`attributes\` and \`channelListings\` of \`{ channel, price }\`.
- Collections: \`name\`, \`slug\`, \`products\` (slugs), \`channelListings\` of
  \`{ channelSlug, isPublished }\`.
- Menus: items are \`{ name, category: <slug> }\` or \`{ name, collection: <slug> }\`.
- Everything referenced (slugs, names) must be defined in the file, or be a default
  every new store has: channel \`default-channel\`, category \`default-category\`.
- The Saleor storefront template shows the \`featured-products\` collection on its
  home page and the \`navbar\` menu as its navigation.

## Example

\`\`\`yaml
${EXAMPLE}\`\`\`
`;

// ── Coding agents on this computer ───────────────────────────────────────

export interface Author {
  readonly id: "claude" | "codex";
  readonly label: string;
}

// What a coding agent's run says about itself, so a person sees which model drafted
// and can open the session to read the whole conversation.
export interface Session {
  readonly agent: Author["id"];
  readonly costUsd: number | undefined;
  readonly durationMs: number;
  readonly id: string | undefined;
  readonly model: string | undefined;
  // The command that opens the session in the agent.
  readonly open: string | undefined;
  readonly tokens: number | undefined;
}

interface Answer {
  readonly session: Session;
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
    ? MODEL_LINE.exec(readFileSync(file, "utf8"))?.[1]
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
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
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
        child.on("close", (code) =>
          code === 0
            ? resolve(out)
            : reject(
                new Error(err.trim().split("\n").at(-1) ?? `exit code ${code}`)
              )
        );
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
      } satisfies Answer;
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

      const text = events
        .filter((event) => event.item?.type === "agent_message")
        .at(-1)?.item?.text;

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
      } satisfies Answer;
    }),
} as const;

const shortId = (id: string) =>
  id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;

// One line about a run: "Claude Code · claude-opus-5-5 · 41 s · $0.21 · session 97353874…4058".
export const sessionLine = (author: Author, session: Session) =>
  [
    author.label,
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

export const installedAuthors = (): readonly Author[] =>
  detectCodingAgents()
    .filter(
      (agent): agent is typeof agent & { id: Author["id"] } =>
        agent.detected && (agent.id === "claude" || agent.id === "codex")
    )
    .map((agent) => ({ id: agent.id, label: agent.label }));

const KNOWN: Readonly<Record<Author["id"], string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

// Who drafts: the agent named with --with (consent without a terminal), else in a
// terminal the installed one, or a pick when there are several. None otherwise:
// unattended runs never start another agent on their own.
export const chooseAuthor = (requested: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(requested)) {
      const id = requested.value;

      if (id !== "claude" && id !== "codex") {
        return yield* fail(
          "USAGE_ERROR",
          `"${id}" is not a coding agent the CLI can draft with.`,
          { suggestion: "Use --with claude or --with codex." }
        );
      }

      return Option.some<Author>({ id, label: KNOWN[id] });
    }

    const authors = installedAuthors();

    if (!(yield* isInteractive) || authors.length === 0) {
      return Option.none<Author>();
    }

    const [only] = authors;

    if (authors.length === 1 && only !== undefined) {
      return Option.some(only);
    }

    const id = yield* askSelect<Author["id"]>({
      choices: authors.map((author) => ({
        label: author.label,
        value: author.id,
      })),
      message: "Which coding agent should draft it?",
    });

    return Option.some<Author>({ id, label: KNOWN[id] });
  });

// ── Drafting ─────────────────────────────────────────────────────────────

const FENCE = /```(?:ya?ml)?\s*\n([\s\S]*?)```/;

const yamlOf = (answer: string) => (FENCE.exec(answer)?.[1] ?? answer).trim();

const parseAnswer = (answer: string) => parseYamlDocument(yamlOf(answer));

export type DraftRequest =
  // A new store: only what the description adds, merged onto the store's defaults.
  | {
      readonly kind: "new";
      readonly description: string;
      readonly base: Config;
    }
  // An existing file: the whole file back, changed as asked.
  | {
      readonly kind: "edit";
      readonly description: string;
      readonly current: Config;
    };

const task = (request: DraftRequest) =>
  request.kind === "new"
    ? [
        "Write the configuration for a new Saleor store described below. Include only",
        "what the description needs: channels, warehouses, shipping zones, attributes,",
        "product types, categories, a few sample products, the featured-products",
        "collection and the navbar menu. It is merged onto the store's defaults.",
        "",
        `Store: ${request.description}`,
      ].join("\n")
    : [
        "Change this store's configuration as the request says, and answer with the",
        "complete updated file. Keep everything else exactly as it is.",
        "",
        `Request: ${request.description}`,
        "",
        "Current config.yml:",
        "```yaml",
        stringify(request.current).trim(),
        "```",
      ].join("\n");

const promptFor = (request: DraftRequest, problems: string | undefined) =>
  [
    GUIDE,
    "## Task",
    "",
    task(request),
    ...(problems === undefined
      ? []
      : [
          "",
          "Your previous answer failed the checks. Fix these problems:",
          problems,
        ]),
    "",
    "Answer with the YAML only: no prose, no explanation.",
  ].join("\n");

const ATTEMPTS = 3;

const fixPrompt = (problems: string) =>
  [
    "Your answer failed the checks. Fix these problems and answer with the",
    "complete YAML again, nothing else:",
    problems,
  ].join("\n");

// What the previous round left: the problems to fix, in the session to fix them in.
interface Previous {
  readonly problems?: string;
  readonly session?: Session;
}

type Round =
  | {
      readonly config: Document;
      readonly passed: true;
      readonly session: Session;
    }
  | {
      readonly passed: false;
      readonly problems: string;
      readonly session: Session;
    };

const passed = (config: Document, session: Session): Round => ({
  config,
  passed: true,
  session,
});

const failed = (problems: string, session: Session): Round => ({
  passed: false,
  problems,
  session,
});

// One round: ask (or, with a session, ask for a fix), then check the answer.
const attemptDraft = (
  author: Author,
  request: DraftRequest,
  file: string,
  previous: Previous
) =>
  Effect.gen(function* () {
    // The first attempt gets the guide and the task; fixes continue that session
    // with only what the checks found.
    const answer = yield* RUNNERS[author.id](
      previous.session?.id === undefined
        ? promptFor(request, previous.problems)
        : fixPrompt(previous.problems ?? ""),
      previous.session?.id
    );

    const { session } = answer;

    yield* notice(`  ${sessionLine(author, session)}`);

    const parsed = parseAnswer(answer.text);

    if (Option.isNone(parsed)) {
      return failed("The answer was not a YAML mapping.", session);
    }

    const config =
      request.kind === "new"
        ? mergeConfig(request.base, parsed.value)
        : orderDocumentLike(request.current, parsed.value);

    writeFileSync(file, stringify(config));

    const checked = yield* Effect.result(validateFile(file));

    return Result.isSuccess(checked)
      ? passed(config, session)
      : failed(checked.failure.message, session);
  });

// Asks the agent, checks the answer with the engine, and sends the problems back
// until it passes or the attempts run out.
export const draftWith = (author: Author, request: DraftRequest) =>
  Effect.gen(function* () {
    const dir = mkdtempSync(path.join(os.tmpdir(), "saleor-draft-"));
    const file = path.join(dir, "config.yml");
    let previous: Previous = {};

    yield* notice(`Drafting the configuration with ${author.label}…`);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const round = yield* attemptDraft(author, request, file, previous);

      if (round.passed) {
        rmSync(dir, { force: true, recursive: true });

        if (round.session.open !== undefined) {
          yield* notice(`  The conversation: ${round.session.open}`);
        }

        return { config: round.config, session: round.session };
      }

      previous = round;

      if (attempt < ATTEMPTS) {
        yield* notice(
          `  The checks found problems; asking for a fix (attempt ${attempt + 1} of ${ATTEMPTS})…`
        );
      }
    }

    rmSync(dir, { force: true, recursive: true });

    const { problems, session } = previous;

    return yield* fail(
      "CONFIG_INVALID",
      `${author.label} did not produce a configuration that passes the checks after ${ATTEMPTS} attempts.\n${problems ?? ""}`,
      {
        details: { session },
        suggestion:
          session?.open === undefined
            ? "Describe the store differently."
            : `Describe the store differently, or read the conversation: ${session.open}`,
      }
    );
  });

// ── Without an agent: a few questions ────────────────────────────────────

export const askAnswers = (shopName: string | undefined) =>
  Effect.gen(function* () {
    const kind = yield* askSelect<KindKey>({
      choices: Object.entries(KINDS).map(
        ([value, each]): Choice<KindKey> => ({
          label: each.label,
          // SAFETY: the keys of KINDS are exactly KindKey.
          value: value as KindKey,
        })
      ),
      message: "What do you sell?",
    });

    const region = yield* askSelect<RegionKey>({
      choices: Object.entries(REGIONS).map(
        ([value, each]): Choice<RegionKey> => ({
          label: each.label,
          // SAFETY: the keys of REGIONS are exactly RegionKey.
          value: value as RegionKey,
        })
      ),
      message: "Where do you sell?",
    });

    const samples = yield* askConfirm(
      "Add a few sample products, so the storefront has something to show?",
      true
    );

    return { kind, region, samples, shopName } satisfies Answers;
  });

export const describeAsked = (prompting: string) =>
  askText({
    message: prompting,
    placeholder:
      "e.g. Outdoor gear in the US and Canada, apparel with sizes and colors",
  });
