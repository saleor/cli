import { Effect, Option } from "effect";
import {
  defineActions,
  type Planned,
  type TargetRef,
} from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { argument, option } from "../../core/inputs.ts";
import {
  askConfirm,
  askSelect,
  isInteractive,
} from "../../core/interaction.ts";
import { command } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import { findProject } from "../../core/project.ts";
import { applyDeploy, deployedText, planDeploy } from "./deploying.ts";
import { fileChanges, sentence } from "./describe.ts";
import { chooseAuthor, draftWith } from "./draft.ts";
import { existingConfig, shown, validateFile } from "./engine.ts";
import { writeConfig } from "./file-output.ts";
import { configFile, connect } from "./store.ts";

const config = defineActions();

const configInput = option.string("config", {
  description:
    "The configuration file. Defaults to the project's (saleor.yml), else ./config.yml.",
  metavar: "path",
});

const withInput = option.string("with", {
  description:
    "The coding agent that drafts it: claude or codex. Needed to draft without a terminal; in a terminal, an installed one is offered.",
  metavar: "agent",
});

const fileTarget = (file: string): TargetRef => ({
  id: null,
  name: shown(file),
  scope: {},
  type: "configuration-file",
});

const descriptionInput = argument.string(
  "description",
  'What to change, in plain words: "add a winter collection with jackets and boots".'
);

// Offers to deploy what was just written, so describe → review → deploy is one run.
const offerDeploy = (file: string) =>
  Effect.gen(function* () {
    const environments = Option.match(findProject(), {
      onNone: () => 0,
      onSome: (found) => found.environments.length,
    });

    if (environments === 0 || !(yield* isInteractive)) {
      return [`Deploy it with: ${command("config", "deploy")}`];
    }

    // The same store `config deploy` would pick: the only environment, or a choice
    // among several, with the same version check.
    const { instance, store } = yield* connect(Option.none(), Option.none());
    const plan = yield* planDeploy(store, file);

    if (plan.deployable.length === 0) {
      return [`${instance.ref} already has all of it.`];
    }

    yield* notice(
      [
        `Deploying to ${instance.ref} would:`,
        ...plan.deployable.map((each) => `  • ${sentence(each)}`),
      ].join("\n")
    );

    if (!(yield* askConfirm(`Deploy to ${instance.ref} now?`, true))) {
      return [`Deploy it later with: ${command("config", "deploy")}`];
    }

    const outcome = yield* applyDeploy({ instance, store, file, plan });
    const words = deployedText(instance, file, outcome);

    return [`✓ ${words.headline}`, words.text].filter(Boolean);
  });

const confirmEdit = (file: string, author: string, lines: readonly string[]) =>
  Effect.gen(function* () {
    if (yield* isInteractive) {
      yield* notice(
        [
          "",
          `${author} suggests:`,
          ...(lines.length > 0
            ? lines.map((line) => `  • ${line}`)
            : ["  (no changes)"]),
          "",
        ].join("\n")
      );

      const choice = yield* askSelect({
        choices: [
          { label: `Write it to ${shown(file)}`, value: "write" },
          { label: "Discard it", value: "discard" },
        ],
        message: "Use this change?",
      });

      if (choice === "discard") {
        return yield* fail("CANCELLED", "Discarded. Nothing was changed.");
      }
    }
  });

export const editCommand = config.ensure({
  description:
    "Change the configuration file from a description in plain words. A coding agent installed on this computer (Claude Code or Codex) drafts the change, without tools and without any token; the CLI checks it, shows what it changes, and writes it once you agree, then offers to deploy. Agents running this CLI edit config.yml themselves instead (see config guide).",
  examples: [
    {
      command:
        'saleor config edit "add a winter collection with jackets and boots"',
      description: "Draft a change with an installed coding agent",
    },
  ],
  inputs: {
    config: configInput,
    description: descriptionInput,
    with: withInput,
  },
  name: "edit",
  plan: (input) =>
    Effect.gen(function* () {
      const file = yield* existingConfig(configFile(input.config));
      const current = yield* validateFile(file);
      const interactive = yield* isInteractive;
      const author = yield* chooseAuthor(input.with);

      if (Option.isNone(author)) {
        return yield* fail(
          "CONTEXT_MISSING",
          interactive
            ? "No coding agent to draft with: install Claude Code or Codex, or edit the file yourself."
            : "Drafting runs a coding agent, which needs --with <agent> when there is no terminal.",
          {
            suggestion: `Edit ${shown(file)} yourself (the rules: ${command("config", "guide")}), check it with ${command("config", "validate")}, then ${command("config", "deploy")}.`,
          }
        );
      }

      const description = Option.getOrUndefined(input.description);

      if (description === undefined) {
        return yield* fail("CONTEXT_MISSING", "Say what to change.", {
          suggestion: `For example: ${command("config", "edit")} "add a winter collection"`,
        });
      }

      if (input.dryRun) {
        return {
          action: "update",
          apply: Effect.die("dry run"),
          details: {
            author: author.value.id,
            config: shown(file),
            description,
          },
          risk: null,
          state: "exists",
          summary: [
            ["File", shown(file)],
            ["Drafted by", author.value.label],
            ["Change", description],
          ],
          target: fileTarget(file),
        } satisfies Planned<never, unknown>;
      }

      const { config: next, session } = yield* draftWith(author.value, {
        current,
        description,
        kind: "edit",
      });

      const lines = fileChanges(current, next);

      yield* confirmEdit(file, author.value.label, lines);

      return {
        action: lines.length === 0 ? "reuse" : "update",
        apply: Effect.gen(function* () {
          if (lines.length > 0) {
            yield* writeConfig(file, next);
          }

          const after = lines.length > 0 ? yield* offerDeploy(file) : [];

          return {
            data: {
              changes: lines,
              config: shown(file),
              created: false,
              description,
              // Which model drafted it, and how to open the conversation.
              session,
            },
            headline:
              lines.length === 0
                ? `${shown(file)} already has that; nothing changed.`
                : `Updated ${shown(file)}: ${lines.length} change${lines.length > 1 ? "s" : ""}.`,
            text: [
              ...(interactive ? [] : lines.map((line) => `  • ${line}`)),
              ...after,
            ].join("\n"),
          };
        }),
        details: { changes: lines, config: shown(file), description },
        risk: null,
        state: "exists",
        summary: [
          ["File", shown(file)],
          ...lines.map((line) => ["", `• ${line}`] as const),
        ],
        target: fileTarget(file),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Change the configuration from a description.",
});
