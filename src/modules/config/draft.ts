import { Effect, Option, Result } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import {
  type AgentRun,
  agentRunLine,
  askAgent,
  HEADLESS_AGENTS,
  type HeadlessAgent,
  installedHeadlessAgents,
} from "../../core/agent-run.ts";
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
  type CatalogKey,
  CATALOGS,
  type RegionKey,
  REGIONS,
} from "./blocks.ts";
import { type Document, parseYamlDocument } from "./document.ts";
import { validateFile } from "./engine.ts";
import { GUIDE } from "./guide.ts";
import { mergeConfig, orderDocumentLike } from "./merge.ts";

// Who writes a configuration from plain words. An agent running the CLI writes it
// itself, guided by `saleor config guide`. A person gets it written by a coding agent
// installed on this computer, run without tools: it only answers with YAML, never
// sees a token, and the CLI checks the answer before anyone deploys it. Without one,
// a few questions pick building blocks (blocks.ts).

type Config = Document;

// Who drafts: the agent named with --with (consent without a terminal), else in a
// terminal the installed one, or a pick when there are several. None otherwise:
// unattended runs never start another agent on their own.
export const chooseAgent = (requested: Option.Option<string>) =>
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

      return Option.some<HeadlessAgent>({ id, label: HEADLESS_AGENTS[id] });
    }

    const agents = installedHeadlessAgents();

    if (!(yield* isInteractive) || agents.length === 0) {
      return Option.none<HeadlessAgent>();
    }

    const [only] = agents;

    if (agents.length === 1 && only !== undefined) {
      return Option.some(only);
    }

    const id = yield* askSelect<HeadlessAgent["id"]>({
      choices: agents.map((agent) => ({
        label: agent.label,
        value: agent.id,
      })),
      message: "Which coding agent should draft it?",
    });

    return Option.some<HeadlessAgent>({ id, label: HEADLESS_AGENTS[id] });
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
  readonly session?: AgentRun;
}

type Round =
  | {
      readonly config: Document;
      readonly passed: true;
      readonly session: AgentRun;
    }
  | {
      readonly passed: false;
      readonly problems: string;
      readonly session: AgentRun;
    };

const passed = (config: Document, session: AgentRun): Round => ({
  config,
  passed: true,
  session,
});

const failed = (problems: string, session: AgentRun): Round => ({
  passed: false,
  problems,
  session,
});

// One round: ask (or, with a session, ask for a fix), then check the answer.
const attemptDraft = ({
  agent,
  request,
  file,
  previous,
}: {
  readonly agent: HeadlessAgent;
  readonly request: DraftRequest;
  readonly file: string;
  readonly previous: Previous;
}) =>
  Effect.gen(function* () {
    // The first attempt gets the guide and the task; fixes continue that session
    // with only what the checks found.
    const answer = yield* askAgent(
      agent,
      previous.session?.id === undefined
        ? promptFor(request, previous.problems)
        : fixPrompt(previous.problems ?? ""),
      previous.session?.id
    );

    const { session } = answer;

    yield* notice(`  ${agentRunLine(agent, session)}`);

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
const draftIn = (agent: HeadlessAgent, request: DraftRequest, file: string) =>
  Effect.gen(function* () {
    let previous: Previous = {};

    yield* notice(`Drafting the configuration with ${agent.label}…`);

    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const round = yield* attemptDraft({
        agent,
        request,
        file,
        previous,
      });

      if (round.passed) {
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

    const { problems, session } = previous;

    return yield* fail(
      "CONFIG_INVALID",
      `${agent.label} did not produce a configuration that passes the checks after ${ATTEMPTS} attempts.\n${problems ?? ""}`,
      {
        details: { session },
        suggestion:
          session?.open === undefined
            ? "Describe the store differently."
            : `Describe the store differently, or read the conversation: ${session.open}`,
      }
    );
  });

// The drafts are checked in a scratch folder, removed however drafting ends (an
// agent that fails or is interrupted included), since it holds the store's file.
export const draftWith = (agent: HeadlessAgent, request: DraftRequest) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(path.join(os.tmpdir(), "saleor-draft-"))),
    (dir) => draftIn(agent, request, path.join(dir, "config.yml")),
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { force: true, recursive: true });
      })
  );

// ── Without an agent: a few questions ────────────────────────────────────

export const askAnswers = (shopName: string | undefined) =>
  Effect.gen(function* () {
    const catalog = yield* askSelect<CatalogKey>({
      choices: Object.keys(CATALOGS)
        .filter((key): key is CatalogKey => Object.hasOwn(CATALOGS, key))
        .map((value): Choice<CatalogKey> => ({
          label: CATALOGS[value].label,
          // SAFETY: the keys of CATALOGS are exactly CatalogKey.
          value,
        })),
      message: "What do you sell?",
    });

    const region = yield* askSelect<RegionKey>({
      choices: Object.keys(REGIONS)
        .filter((key): key is RegionKey => Object.hasOwn(REGIONS, key))
        .map((value): Choice<RegionKey> => ({
          label: REGIONS[value].label,
          // SAFETY: the keys of REGIONS are exactly RegionKey.
          value,
        })),
      message: "Where do you sell?",
    });

    const samples = yield* askConfirm(
      "Add a few sample products, so the storefront has something to show?",
      true
    );

    return { catalog, region, samples, shopName } satisfies Answers;
  });

export const describeAsked = (prompting: string) =>
  askText({
    message: prompting,
    placeholder:
      "e.g. Outdoor gear in the US and Canada, apparel with sizes and colors",
  });

export { GUIDE } from "./guide.ts";
