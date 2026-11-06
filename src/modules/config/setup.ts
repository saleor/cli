import { Effect, Option, Predicate } from "effect";
import { given } from "../../core/target.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { option } from "../../core/inputs.ts";
import { resolveStore } from "../../core/stores.ts";
import { askSelect, isInteractive } from "../../core/interaction.ts";
import { command, recordAnswer } from "../../core/invocation.ts";
import { notice, shown } from "../../core/output.ts";
import { recordDeploy } from "../../core/deploy-record.ts";
import { configuresOnCreate } from "../../core/manifest.ts";
import {
  configPath,
  projectAt,
  projectFolder,
  rememberEnvironment,
} from "../../core/project.ts";
import { defineSetupExtension, type SetupResult } from "../../core/setup.ts";
import {
  applyConfiguration,
  configurationPending,
  hasConfiguration,
} from "../../core/project-configuration.ts";
import { fromAnswers } from "./blocks.ts";
import { applyDeploy, deployedText, planDeploy } from "./deploying.ts";
import { review } from "./describe.ts";
import { type Document, parseYamlDocument } from "./document.ts";
import { askAnswers, chooseAgent, describeAsked, draftWith } from "./draft.ts";
import {
  type AgentRun,
  type HeadlessAgent,
  installedHeadlessAgents,
} from "../../core/agent-run.ts";
import { pull } from "./engine.ts";
import { reviewText, writeConfig } from "./file-output.ts";
import { mergeConfig, NEW_STORE } from "./merge.ts";
import { sampleConfiguration } from "./sample.ts";
import { environmentName } from "./store.ts";
import {
  connectStore,
  connectTo,
  type StoreClient,
} from "../../core/store-api.ts";

type Config = Document;

// Where the first configuration comes from.
type Source =
  | {
      readonly kind: "drafted";
      readonly by: string;
      readonly config: Config;
      // The coding agent's run, when one drafted it.
      readonly session: AgentRun | undefined;
    }
  | { readonly kind: "copy"; readonly ref: string }
  // Saleor's sample data, loaded into the store; the file is pulled from it.
  | { readonly kind: "sample" }
  // Not drafted in this run: a dry run, or an agent running the CLI, which writes
  // the file itself from the guide.
  | {
      readonly kind: "later";
      readonly description: string;
      readonly who: Option.Option<HeadlessAgent>;
    };

type Drafted = Extract<Source, { readonly kind: "drafted" }>;

const drafted = (agent: HeadlessAgent, description: string) =>
  Effect.map(
    draftWith(agent, { base: NEW_STORE, description, kind: "new" }),
    ({ config, session }): Drafted => ({
      by: `drafted by ${agent.label} from “${description}”`,
      config,
      kind: "drafted",
      session,
    })
  );

// Drafts (or, without a coding agent, asks a few questions), shows the review, and
// lets the person accept it or try again. Returns the accepted configuration.
const draftInteractively = (agent: Option.Option<HeadlessAgent>) =>
  Effect.gen(function* () {
    for (;;) {
      const source: Drafted = Option.isSome(agent)
        ? yield* drafted(
            agent.value,
            yield* describeAsked(
              "Describe the store: what it sells, where, and how"
            )
          )
        : {
            by: "from your answers",
            config: mergeConfig(
              NEW_STORE,
              fromAnswers(yield* askAnswers(undefined))
            ),
            kind: "drafted",
            session: undefined,
          };

      yield* notice(
        ["", "The store will have:", ...reviewText(source.config), ""].join(
          "\n"
        )
      );

      const next = yield* askSelect({
        choices: [
          { label: "Use this configuration", value: "use" },
          {
            label: Option.isSome(agent)
              ? "Describe it differently"
              : "Answer again",
            value: "again",
          },
        ],
        message: "Use it?",
      });

      if (next === "use") {
        return source;
      }
    }
  });

const chooseSource = (input: {
  readonly copyFrom: Option.Option<string>;
  readonly describe: Option.Option<string>;
  readonly dryRun: boolean;
  readonly with: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(input.copyFrom)) {
      return Option.some<Source>({ kind: "copy", ref: input.copyFrom.value });
    }

    if (Option.isSome(input.describe)) {
      const description = input.describe.value;
      const agent = yield* chooseAgent(input.with);

      if (Option.isNone(agent) || input.dryRun) {
        return Option.some<Source>({ description, kind: "later", who: agent });
      }

      return Option.some(yield* drafted(agent.value, description));
    }

    if (input.dryRun || !(yield* isInteractive)) {
      return Option.none<Source>();
    }

    // With a coding agent, a description; without one, a few questions instead.
    // Which agent drafts is asked only once a description is wanted.
    const agents = installedHeadlessAgents();

    const choice = yield* askSelect({
      choices: [
        agents.length > 0
          ? {
              hint: `drafted by ${agents.map((each) => each.label).join(" or ")}`,
              label: "Describe it in plain words",
              value: "describe",
            }
          : { label: "Answer a few questions", value: "questions" },
        { label: "Copy another store's configuration", value: "copy" },
        {
          hint: "products, orders and customers to try things with",
          label: "Use Saleor's sample data",
          value: "sample",
        },
      ],
      message: "What should the store contain?",
    });

    if (choice === "sample") {
      return Option.some<Source>({ kind: "sample" });
    }

    if (choice === "copy") {
      // Any store, not the project's own environment, which is what is being set up.
      const { store } = yield* resolveStore(given(), {
        anyStore: true,
      });

      yield* recordAnswer({ option: ["--copy-from", store.ref] });

      return Option.some<Source>({ kind: "copy", ref: store.ref });
    }

    return Option.some<Source>(
      yield* draftInteractively(
        choice === "describe" ? yield* chooseAgent(input.with) : Option.none()
      )
    );
  });

const describeSource = (source: Source) => {
  switch (source.kind) {
    case "copy": {
      return `copied from ${source.ref}`;
    }

    case "sample": {
      return "Saleor's sample data";
    }

    case "later": {
      return Option.match(source.who, {
        onNone: () =>
          `“${source.description}”, written by the agent running this CLI`,
        onSome: (agent) =>
          `drafted by ${agent.label} from “${source.description}”`,
      });
    }

    case "drafted": {
      return source.by;
    }
  }
};

interface Finishing {
  readonly chosen: Source;
  readonly file: string;
  readonly made: SetupResult;
  readonly name: string;
  readonly root: string;
}

// For an agent running the CLI: the file starts as the store's real configuration,
// so what the agent adds is complete and every difference in it is one it means.
const startForAgent = ({
  finishing,
  description,
  target,
  kept,
}: {
  readonly finishing: Finishing;
  readonly description: string;
  readonly target: StoreClient;
  readonly kept: Option.Option<Document>;
}) =>
  Effect.gen(function* () {
    const { file, made, root } = finishing;

    if (Option.isNone(kept)) {
      yield* writeConfig(file, yield* pull(target));
      yield* recordDeploy(file, made.ref);
    }

    return {
      config: file,
      description,
      lines: [
        `Next: add what “${description}” needs to ${shown(file)} (${Option.isNone(kept) ? "it holds the new store's defaults" : "kept as it was"}).`,
        `  The rules and an example: ${command("config", "guide")}`,
        `  Check it: ${command("config", "validate")}`,
        `  Deploy it: ${command("config", "deploy")} (from ${shown(root) || "."})`,
      ],
    };
  });

const copied = (ref: string) => Effect.flatMap(connectStore(given(ref)), pull);

// Writes the drafted (or copied) configuration over the store's own, deploys it,
// and says what the store now has.
const deployDraft = ({
  finishing,
  draft,
  target,
  kept,
}: {
  readonly finishing: Finishing;
  readonly draft: Document;
  readonly target: StoreClient;
  readonly kept: Option.Option<Document>;
}) =>
  Effect.gen(function* () {
    const { file, made } = finishing;

    // Laid over what the store has (or the project's file, when `init` runs again),
    // so nothing it has is deleted.
    const config = mergeConfig(
      Option.isSome(kept) ? kept.value : yield* pull(target),
      draft
    );

    yield* writeConfig(file, config);

    const plan = yield* planDeploy(target, file);

    const outcome = yield* applyDeploy({ client: target, file, plan });

    const words = deployedText(made, file, outcome);

    return {
      applied: outcome.applied.length,
      config: file,
      lines: [
        `✓ ${words.headline}`,
        ...reviewText(config),
        ...words.text
          .split("\n")
          .filter((line) => line !== "" && !line.startsWith("  • ")),
      ],
      missed: outcome.missed.length,
    };
  });

export { prepareSampleData, sampleConfiguration } from "./sample.ts";

const loadSample = ({ file, made }: Finishing) =>
  Effect.gen(function* () {
    const save =
      (yield* isInteractive) &&
      (yield* askSelect({
        choices: [
          {
            hint: "Requires access to the store API",
            label: "Save configuration locally",
            value: "save",
          },
          {
            hint: "Continue setup without a store API token",
            label: "Skip for now",
            value: "skip",
          },
        ],
        message: "Save the sample store's configuration to config.yml?",
      }));

    return yield* sampleConfiguration(made, file, save === "save");
  });

const contents = ({
  finishing,
  chosen,
  target,
  kept,
}: {
  readonly finishing: Finishing;
  readonly chosen: Exclude<Source, { readonly kind: "sample" }>;
  readonly target: StoreClient;
  readonly kept: Option.Option<Document>;
}) =>
  Effect.gen(function* () {
    switch (chosen.kind) {
      case "later": {
        return yield* startForAgent({
          finishing,
          description: chosen.description,
          target,
          kept,
        });
      }

      case "copy": {
        return yield* deployDraft({
          finishing,
          draft: yield* copied(chosen.ref),
          target,
          kept,
        });
      }

      case "drafted": {
        return yield* deployDraft({
          finishing,
          draft: chosen.config,
          target,
          kept,
        });
      }
    }
  });

const finish = (finishing: Finishing) =>
  Effect.gen(function* () {
    const { chosen, file, made, name, root } = finishing;

    const { name: environment } = yield* rememberEnvironment({
      root,
      wanted: environmentName(made),
      ref: made.ref,
      defaults: { name },
    });

    if (chosen.kind === "sample") {
      const { lines, ...data } = yield* loadSample(finishing);

      return {
        data: { ...data, environment, session: null },
        text: lines.join("\n"),
      };
    }

    const target = yield* connectTo(made);

    // Running `init` again keeps the project's file: drafts are added to it. The
    // empty file `init` itself starts the project with is not worth keeping: the
    // store's own configuration is pulled instead.
    const kept = existsSync(file)
      ? Option.filter(
          parseYamlDocument(readFileSync(file, "utf-8")),
          (document) => Object.keys(document).length > 0
        )
      : Option.none();

    const outcome = yield* contents({ finishing, chosen, target, kept });
    const { lines, ...data } = outcome;

    // Which model drafted it, and how to open the conversation, when an agent did.
    const session = chosen.kind === "drafted" ? chosen.session : undefined;

    return {
      data: { ...data, environment, session: session ?? null },
      text: [
        ...lines,
        ...(chosen.kind === "later"
          ? []
          : [
              `Kept in ${shown(file)}, with saleor.yml naming the store "${environment}". Change it with: ${command("config", "edit")} "…"`,
            ]),
      ].join("\n"),
    };
  });

const initializeConfiguration = (root: string, made: SetupResult) =>
  Effect.gen(function* () {
    const project = projectAt(root);

    if (Option.isNone(project) || made.kind !== "local") {
      return { data: {}, text: "" };
    }

    const environment = project.value.environments.find(
      ([, ref]) => ref === made.ref
    )?.[0];

    const definition =
      environment === undefined
        ? undefined
        : project.value.definitions?.[environment];

    if (
      definition === undefined ||
      Predicate.isString(definition) ||
      !configuresOnCreate(definition)
    ) {
      return { data: {}, text: "" };
    }

    const file = configPath(project.value);

    if (!hasConfiguration(file)) {
      // Nothing to apply; the store matches the file as it is.
      yield* recordDeploy(file, made.ref);

      return {
        data: { file },
        text: "Project configuration is empty; ready for editing.",
      };
    }

    if (!configurationPending(file, made.ref, made.created)) {
      return { data: {}, text: "" };
    }

    yield* applyConfiguration(yield* connectTo(made), file);

    return { data: { file }, text: "Project configuration applied." };
  });

// `saleor init` asks what the store should contain, after where it runs: a
// description drafted by a coding agent, a few questions, or a copy of another
// store. The configuration lands in the project folder, next to the storefront.
export const configSetup = defineSetupExtension({
  description:
    "It also asks what the store should contain (or pass --describe <words>): a coding agent installed on this computer drafts the configuration, or a few questions pick building blocks; it is checked, reviewed and deployed, and kept in <project>/config.yml with saleor.yml naming the store. --copy-from <ref> copies another store's configuration instead. Agents running the CLI get the description back and write config.yml themselves.",
  inputs: {
    copyFrom: option.string("copy-from", {
      description:
        "Start the store's configuration as a copy of another store's: a ref, cloud:<org>/<env key> or local:<name>.",
      metavar: "ref",
    }),
    describe: option.string("describe", {
      description:
        "What the store should contain, in plain words. Drafted by a coding agent installed here (in a terminal, or with --with); otherwise returned for the calling agent to write.",
      metavar: "words",
    }),
    with: option.string("with", {
      description:
        "The coding agent that drafts the configuration: claude or codex.",
      metavar: "agent",
    }),
  },
  plan: (input, store) =>
    Effect.gen(function* () {
      const source = yield* chooseSource(input);

      const name = store.target.scope.project ?? store.target.name;
      const root = projectFolder(name);

      if (Option.isNone(source)) {
        return Option.some({
          apply: (made) => initializeConfiguration(root, made),
          changes: true,
          details: { source: "project" },
          name: "config",
          prepare: Effect.void,
          summary: [],
        });
      }

      const file = Option.match(projectAt(root), {
        onNone: () => path.join(root, "config.yml"),
        onSome: configPath,
      });

      const chosen = source.value;

      return Option.some({
        apply: (made) => finish({ chosen, file, made, name, root }),
        // A configuration is deployed onto an empty store, not Saleor's sample data.
        blankStore: chosen.kind !== "sample",
        changes: true,
        details: {
          config: file,
          source: describeSource(chosen),
        },
        name: "config",
        prepare: Effect.void,
        summary: [
          [
            "Configuration",
            `${shown(file) || file} (${describeSource(chosen)})`,
          ] as const,
          ...(chosen.kind === "drafted"
            ? review(chosen.config).map(
                ([label, value]) => ["", `${label}: ${value}`] as const
              )
            : []),
        ],
      });
    }),
});
