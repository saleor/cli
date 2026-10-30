import { Effect, Option, Predicate } from "effect";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { resolveInstance } from "../../core/instances.ts";
import { askSelect, isInteractive } from "../../core/interaction.ts";
import { command, recordAnswer } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import {
  configPath,
  lastInSync,
  projectAt,
  projectFolder,
  recordInSync,
  rememberEnvironment,
} from "../../core/project.ts";
import { defineSetupExtension, type SetupResult } from "../../core/setup.ts";
import { storeAccess } from "../../core/store-access.ts";
import { fromAnswers } from "./blocks.ts";
import { applyDeploy, deployedText, planDeploy } from "./deploying.ts";
import { review } from "./describe.ts";
import { type Document, parseYamlDocument } from "./document.ts";
import {
  askAnswers,
  type Author,
  chooseAuthor,
  describeAsked,
  draftWith,
  installedAuthors,
  type Session,
} from "./draft.ts";
import { pull, shown, type Store } from "./engine.ts";
import { reviewText, writeConfig } from "./file-output.ts";
import { mergeConfig, NEW_STORE } from "./merge.ts";
import { sampleConfiguration } from "./sample.ts";
import { connectMade, environmentName } from "./store.ts";

type Config = Document;

// Where the first configuration comes from.
type Source =
  | {
      readonly kind: "drafted";
      readonly by: string;
      readonly config: Config;
      // The coding agent's run, when one drafted it.
      readonly session: Session | undefined;
    }
  | { readonly kind: "copy"; readonly ref: string }
  // Saleor's sample data, loaded into the store; the file is pulled from it.
  | { readonly kind: "sample" }
  // Not drafted in this run: a dry run, or an agent running the CLI, which writes
  // the file itself from the guide.
  | {
      readonly kind: "later";
      readonly description: string;
      readonly who: Option.Option<Author>;
    };

type Drafted = Extract<Source, { readonly kind: "drafted" }>;

const drafted = (author: Author, description: string) =>
  Effect.map(
    draftWith(author, { base: NEW_STORE, description, kind: "new" }),
    ({ config, session }): Drafted => ({
      by: `drafted by ${author.label} from “${description}”`,
      config,
      kind: "drafted",
      session,
    })
  );

// Drafts (or, without a coding agent, asks a few questions), shows the review, and
// lets the person accept it or try again. Returns the accepted configuration.
const draftInteractively = (author: Option.Option<Author>) =>
  Effect.gen(function* () {
    for (;;) {
      const source: Drafted = Option.isSome(author)
        ? yield* drafted(
            author.value,
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
            label: Option.isSome(author)
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
      const author = yield* chooseAuthor(input.with);

      if (Option.isNone(author) || input.dryRun) {
        return Option.some<Source>({ description, kind: "later", who: author });
      }

      return Option.some(yield* drafted(author.value, description));
    }

    if (input.dryRun || !(yield* isInteractive)) {
      return Option.none<Source>();
    }

    // With a coding agent, a description; without one, a few questions instead.
    // Which agent drafts is asked only once a description is wanted.
    const authors = installedAuthors();

    const choice = yield* askSelect({
      choices: [
        authors.length > 0
          ? {
              hint: `drafted by ${authors.map((each) => each.label).join(" or ")}`,
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
      const { instance } = yield* resolveInstance(Option.none());

      yield* recordAnswer({ option: ["--copy-from", instance.ref] });

      return Option.some<Source>({ kind: "copy", ref: instance.ref });
    }

    return Option.some<Source>(
      yield* draftInteractively(
        choice === "describe" ? yield* chooseAuthor(input.with) : Option.none()
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
        onSome: (author) =>
          `drafted by ${author.label} from “${source.description}”`,
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
  readonly target: Store;
  readonly kept: Option.Option<Document>;
}) =>
  Effect.gen(function* () {
    const { file, made, root } = finishing;

    if (Option.isNone(kept)) {
      yield* writeConfig(file, yield* pull(target));
      yield* recordInSync(file, made.ref);
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

const copied = (ref: string) =>
  Effect.gen(function* () {
    const resolved = yield* resolveInstance(Option.some(ref));
    const access = yield* storeAccess(resolved);

    return yield* pull({
      token: access.token,
      url: resolved.instance.graphqlUrl,
    });
  });

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
  readonly target: Store;
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

    const outcome = yield* applyDeploy({
      instance: made,
      store: target,
      file,
      plan,
    });

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

const contents = (
  finishing: Finishing,
  target: Store,
  kept: Option.Option<Document>
) =>
  Effect.gen(function* () {
    const { chosen } = finishing;

    switch (chosen.kind) {
      case "later": {
        return yield* startForAgent({
          finishing,
          description: chosen.description,
          target,
          kept,
        });
      }

      case "sample": {
        return yield* loadSample(finishing);
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

    const target = yield* connectMade(made);

    // Running `init` again keeps the project's file: drafts are added to it.
    const kept = existsSync(file)
      ? parseYamlDocument(readFileSync(file, "utf-8"))
      : Option.none();

    const outcome = yield* contents(finishing, target, kept);
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

    const alias = project.value.environments.find(
      ([, ref]) => ref === made.ref
    )?.[0];

    const definition =
      alias === undefined ? undefined : project.value.definitions?.[alias];

    if (
      Predicate.isString(definition) ||
      definition?.configure !== "on-create"
    ) {
      return { data: {}, text: "" };
    }

    const file = configPath(project.value);

    if (!made.created && Option.isSome(lastInSync(file, made.ref))) {
      return { data: {}, text: "" };
    }

    if (readFileSync(file, "utf-8").trim() === "{}") {
      yield* recordInSync(file, made.ref);

      return {
        data: { file },
        text: "Project configuration is empty; ready for editing.",
      };
    }

    const target = yield* connectMade(made);
    const plan = yield* planDeploy(target, file);

    const outcome = yield* applyDeploy({
      instance: made,
      store: target,
      file,
      plan,
    });

    if (outcome.missed.length > 0) {
      return yield* fail(
        "DEPLOY_PARTIAL",
        "Project configuration is incomplete. Run saleor local up to retry."
      );
    }

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
