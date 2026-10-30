import { Effect, Option } from "effect";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  defineActions,
  defineGroup,
  listing,
  type Planned,
  type TargetRef,
} from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { argument, option } from "../../core/inputs.ts";
import type { Instance } from "../../core/instance.ts";
import { instanceInput } from "../../core/instances.ts";
import { command } from "../../core/invocation.ts";
import {
  ago,
  findProject,
  lastInSync,
  recordInSync,
} from "../../core/project.ts";
import {
  applyDeploy,
  counted,
  deployedText,
  planDeploy,
  planRows,
} from "./deploying.ts";
import { applies, pulledSentence, review } from "./describe.ts";
import { GUIDE } from "./draft.ts";
import { editCommand } from "./edit-command.ts";
import {
  change,
  diff,
  existingConfig,
  pull,
  sections,
  serialize,
  shown,
  validateFile,
} from "./engine.ts";
import { configFile, connect, remember } from "./store.ts";

const config = defineActions();

const configInput = option.string("config", {
  description:
    "The configuration file. Defaults to the project's (saleor.yml), else ./config.yml.",
  metavar: "path",
});

const environmentInput = argument.string(
  "environment",
  "An environment named in the project's saleor.yml (or a store ref). Defaults to the project's only environment."
);

const fileTarget = (file: string): TargetRef => ({
  id: null,
  name: shown(file),
  scope: {},
  type: "configuration-file",
});

const storeTarget = (store: Instance): TargetRef => ({
  id: store.ref,
  name: store.name,
  scope: {},
  type: "store",
});

const validateCommand = config.session({
  description:
    "Check a configuration file against Configurator's schema and its rules (attribute references, duplicate names), without contacting any store. Stricter than the standalone tool's validate, which checks the schema only.",
  examples: [
    {
      command: "saleor config validate",
      description: "Check the project's file",
    },
  ],
  inputs: { config: configInput },
  name: "validate",
  run: (input) =>
    Effect.gen(function* () {
      const file = yield* existingConfig(configFile(input.config));
      const parsed = yield* validateFile(file);

      return result(
        { config: shown(file), sections: sections(parsed), valid: true },
        [
          `✓ ${shown(file)} is valid. It describes:`,
          ...review(parsed).map(([label, value]) => `  ${label}: ${value}`),
        ].join("\n")
      );
    }),
  summary: "Check a configuration file offline.",
});

const pullCommand = config.ensure({
  description:
    "Write a store's configuration to the project's file (Configurator's introspect). When the file exists, the plan says in words what changed in the store since; replacing it asks first, since edits not yet deployed are lost. The store is remembered in saleor.yml.",
  examples: [
    {
      command: "saleor config pull --instance local:demo",
      description: "Start a project from a local store",
    },
    {
      command: "saleor config pull staging --dry-run",
      description: "See what changed in staging since the last pull",
    },
  ],
  inputs: {
    config: configInput,
    environment: environmentInput,
    instance: instanceInput,
  },
  name: "pull",
  plan: (input) =>
    Effect.gen(function* () {
      const file = configFile(input.config);

      const { instance, store } = yield* connect(
        input.environment,
        input.instance
      );

      const existing = existsSync(file) ? readFileSync(file, "utf-8") : null;

      // What the store changed, seen from the file. None when the file cannot be
      // compared (it is invalid, maybe mid-edit): what it would lose is unknown.
      const compared =
        existing === null
          ? Option.some([])
          : yield* diff(store, file).pipe(
              Effect.map((summary) => Option.some(summary.results.map(change))),
              Effect.orElseSucceed(() => Option.none())
            );

      const changed = Option.getOrElse(compared, () => []);

      const pulled = yield* pull(store);
      const yaml = yield* serialize(pulled);
      const same = existing === yaml;

      let action: "create" | "reuse" | "update" = same ? "reuse" : "update";

      if (existing === null) {
        action = "create";
      }

      return {
        action,
        apply: Effect.gen(function* () {
          if (!same) {
            writeFileSync(file, yaml);
          }

          yield* recordInSync(file, instance.ref);
          const remembered = yield* remember(file, instance);

          return {
            data: {
              changes: changed,
              config: shown(file),
              created: existing === null,
              sections: sections(pulled),
              store: instance.ref,
              written: !same,
            },
            headline: same
              ? `${shown(file)} already matches ${instance.ref}.`
              : `Wrote ${shown(file)} from ${instance.ref}.`,
            text: [
              ...changed.map((each) => `  • ${pulledSentence(each)}`),
              ...(existing === null
                ? review(pulled).map(([label, value]) => `  ${label}: ${value}`)
                : []),
              ...(remembered === undefined ? [] : [remembered]),
            ].join("\n"),
          };
        }),
        details: { config: shown(file), store: instance.ref },
        // A file whose content the store already matches loses nothing: only its
        // formatting changes to the store's.
        risk:
          existing !== null &&
          !same &&
          (Option.isNone(compared) || changed.length > 0)
            ? `Replaces the content of ${shown(file)}; edits not deployed to a store are lost.`
            : null,
        state: existing === null ? "absent" : "exists",
        summary: [
          ["Store", instance.ref],
          ["File", shown(file)],
          ...changed
            .slice(0, 12)
            .map((each) => ["", `• ${pulledSentence(each)}`] as const),
          ...(existing !== null &&
          !same &&
          Option.isSome(compared) &&
          changed.length === 0
            ? [
                [
                  "Note",
                  "The store matches the file; pulling rewrites it in the store's order and format.",
                ] as const,
              ]
            : []),
        ],
        target: fileTarget(file),
      } satisfies Planned<unknown, unknown>;
    }),
  risk: "Replaces an existing configuration file; edits not deployed to a store are lost.",
  summary: "Write a store's configuration to a file.",
});

const diffCommand = config.list({
  description:
    "Show how a store differs from the configuration file: one row per entity, and whether a deploy changes it. Deploys create and update; they never delete, and never update categories. Changes nothing. Exits 0 either way.",
  examples: [
    {
      command: "saleor config diff",
      description: "Compare with the project's environment",
    },
    {
      command: "saleor config diff staging",
      description: "Compare with staging",
    },
  ],
  inputs: {
    config: configInput,
    environment: environmentInput,
    instance: instanceInput,
  },
  name: "diff",
  run: (input) =>
    Effect.gen(function* () {
      const file = yield* existingConfig(configFile(input.config));
      yield* validateFile(file);

      const { instance, store } = yield* connect(
        input.environment,
        input.instance
      );

      const summary = yield* diff(store, file);

      return listing(
        summary.results
          .map(change)
          .map((each) => ({ ...each, deploy: applies(each) })),
        [
          ["CHANGE", (each) => each.operation],
          ["ENTITY", (each) => each.entity],
          ["NAME", (each) => each.name],
          ["DEPLOY", (each) => (each.deploy ? "yes" : "no")],
          [
            "FIELDS",
            (each) => (each.fields.length > 0 ? each.fields.join(", ") : null),
          ],
        ],
        `No differences: ${instance.ref} matches ${shown(file)}.`
      );
    }),
  summary: "Show what a deploy would change.",
});

const deployCommand = config.ensure({
  description:
    "Make a store match the configuration file: create and update entities until it has what the file says. The plan lists each change as a sentence, and what a deploy leaves as it is (it never deletes). After applying, it compares again and reports what actually changed. A partial failure exits with DEPLOY_PARTIAL; running it again retries what is left.",
  examples: [
    {
      command: "saleor config deploy",
      description: "Deploy to the project's environment",
    },
    {
      command: "saleor config deploy staging --dry-run",
      description: "Show the plan for staging",
    },
    {
      command: "SALEOR_TOKEN=… saleor config deploy --instance cloud:acme/env1",
      description: "Deploy from CI with a store token",
    },
  ],
  inputs: {
    config: configInput,
    environment: environmentInput,
    instance: instanceInput,
  },
  name: "deploy",
  plan: (input) =>
    Effect.gen(function* () {
      const file = yield* existingConfig(configFile(input.config));
      yield* validateFile(file);

      const { instance, store } = yield* connect(
        input.environment,
        input.instance
      );

      const plan = yield* planDeploy(store, file);

      return {
        action: plan.deployable.length === 0 ? "reuse" : "update",
        apply: Effect.gen(function* () {
          const outcome = yield* applyDeploy({
            instance,
            store,
            file,
            plan,
          });

          const remembered = yield* remember(file, instance);
          const words = deployedText(instance, file, outcome);

          return {
            data: {
              applied: outcome.applied,
              created: false,
              durationMs: outcome.durationMs,
              missed: outcome.missed,
              skipped: outcome.skipped,
              store: instance.ref,
            },
            headline: words.headline,
            text: [words.text, remembered ?? ""].filter(Boolean).join("\n"),
          };
        }),
        details: {
          config: shown(file),
          deployable: plan.deployable,
          skipped: plan.skipped,
          store: instance.ref,
        },
        risk: null,
        state: instance.state,
        summary: [
          ["Store", instance.ref],
          ["File", shown(file)],
          ["Changes", counted(plan.deployable)],
          ...planRows(plan),
        ],
        target: storeTarget(instance),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Make a store match a configuration file.",
});

const statusCommand = config.list({
  description:
    "For each environment in the project's saleor.yml: whether its store matches the configuration file, and how many changes a deploy would make. Contacts every store.",
  examples: [
    { command: "saleor config status", description: "Check every environment" },
  ],
  inputs: { config: configInput },
  name: "status",
  run: (input) =>
    Effect.gen(function* () {
      const project = yield* Option.match(findProject(), {
        onNone: () =>
          fail(
            "NOT_FOUND",
            "Not in a project: there is no saleor.yml here or above.",
            {
              suggestion: `Start one with: ${command("config", "pull")} --instance <ref>`,
            }
          ),
        onSome: Effect.succeed,
      });

      const file = yield* existingConfig(configFile(input.config));
      yield* validateFile(file);

      const rows = yield* Effect.forEach(project.environments, ([name, ref]) =>
        Effect.gen(function* () {
          const { instance, store } = yield* connect(
            Option.some(ref),
            Option.none()
          );

          const plan = yield* planDeploy(store, file);
          const synced = lastInSync(file, ref);

          return {
            deployable: plan.deployable.length,
            environment: name,
            lastDeployed: Option.match(synced, {
              onNone: () => null,
              onSome: (note) => note.at.toISOString(),
            }),
            ref,
            saleorVersion: instance.saleorVersion,
            skipped: plan.skipped.length,
            state:
              plan.deployable.length === 0 ? "in sync" : "changes to deploy",
          };
        }).pipe(
          Effect.catchTag("CliFailure", (failure) =>
            Effect.succeed({
              deployable: 0,
              environment: name,
              lastDeployed: null,
              ref,
              saleorVersion: null,
              skipped: 0,
              state: `unknown: ${failure.code}`,
            })
          )
        )
      );

      return listing(
        rows,
        [
          ["ENVIRONMENT", (row) => row.environment],
          ["STORE", (row) => row.ref],
          ["STATE", (row) => row.state],
          ["TO DEPLOY", (row) => String(row.deployable)],
          ["VERSION", (row) => row.saleorVersion],
          [
            "LAST DEPLOYED HERE",
            (row) =>
              row.lastDeployed === null
                ? null
                : ago(new Date(row.lastDeployed)),
          ],
        ],
        "This project has no environments yet. Add one with a pull or deploy and --instance <ref>."
      );
    }),
  summary: "Show whether each environment matches the file.",
});

const guideCommand = config.session({
  description:
    "Print the rules for writing config.yml, with a complete example. For coding agents that write or change a configuration themselves; the CLI gives the same guide to the agents it runs.",
  examples: [
    {
      command: "saleor config guide --agent",
      description: "The guide as JSON",
    },
  ],
  inputs: {},
  name: "guide",
  run: () => Effect.succeed(result({ guide: GUIDE }, GUIDE)),
  summary: "How to write config.yml (for agents).",
});

export const configCommand = defineGroup({
  actions: [
    statusCommand,
    diffCommand,
    deployCommand,
    editCommand,
    pullCommand,
    validateCommand,
    guideCommand,
  ],
  description:
    "Store configuration as code, with Saleor Configurator's engine. Inside a project (saleor.yml), commands act on its environments by name: saleor config deploy staging. Describe changes in plain words with config edit; see where each environment stands with config status. Store API tokens come from SALEOR_TOKEN, a token saved for the store, or a prompt; local stores need none.",
  name: "config",
  summary: "Configure your store's catalog and settings.",
});

// The line above the home menu inside a project: the store and whether the file
// changed since it was last deployed from here. Reads local files only.
export const projectStatus = Effect.sync(() =>
  Option.match(findProject(), {
    onNone: () => undefined,
    onSome: (project) => {
      const [first] = project.environments;

      if (first === undefined) {
        return `Project ${project.name}: no environments yet.`;
      }

      const [name, ref] = first;
      const file = configFile(Option.none());
      const note = lastInSync(file, ref);
      const where = `Project ${project.name} · ${name} (${ref})`;

      return Option.match(note, {
        onNone: () => `${where} · not deployed from here yet`,
        onSome: ({ at, edited }) =>
          edited
            ? `${where} · ${shown(file)} edited since the last deploy (${ago(at)})`
            : `${where} · in sync with ${shown(file)} as of ${ago(at)}`,
      });
    },
  })
);
