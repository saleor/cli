import { Effect, Option, Semaphore } from "effect";
import { Command } from "effect/cli";
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
import { HideFromMenu } from "../../core/menu.ts";
import { option } from "../../core/inputs.ts";
import { envInput } from "../../core/stores.ts";
import { command } from "../../core/invocation.ts";
import { notice, shown } from "../../core/output.ts";
import { lastDeploy, recordDeploy } from "../../core/deploy-record.ts";
import { ago } from "../../core/durations.ts";
import { findProject } from "../../core/project.ts";
import { planDeploy } from "./deploying.ts";
import { applies, pulledSentence, review } from "./describe.ts";
import { GUIDE } from "./draft.ts";
import { editCommand } from "./edit-command.ts";
import { change, diff, pull, sections, serialize } from "./engine.ts";
import { deployCommand } from "./deploy-command.ts";
import {
  checkedFiles,
  configFile,
  connect,
  deployedInput,
  filesShown,
  remember,
} from "./store.ts";

const config = defineActions();

const configInput = option.string("config", {
  description:
    "The configuration file. Defaults to the project's (saleor.yml), else ./config.yml.",
  metavar: "path",
});

const fileTarget = (file: string): TargetRef => ({
  id: null,
  name: shown(file),
  scope: {},
  type: "configuration-file",
});

const validateCommand = config.session({
  description:
    "Check configuration files against Configurator's schema and its rules (attribute references, duplicate names), without contacting any store: the project's own and each component's, or the --config file. Stricter than the standalone tool's validate, which checks the schema only.",
  examples: [
    {
      command: "saleor config validate",
      description: "Check the project's file",
    },
  ],
  inputs: { config: deployedInput },
  name: "validate",
  run: (input) =>
    Effect.gen(function* () {
      const [first, ...rest] = yield* checkedFiles(input.config);

      if (first === undefined) {
        return yield* fail("NOT_FOUND", "No configuration file to check.");
      }

      const checked = [first, ...rest];

      // `config` and `sections` describe the project's own file, as before components.
      return result(
        {
          config: shown(first.file),
          configs: checked.map(({ component, file, parsed }) => ({
            component: component ?? null,
            config: shown(file),
            sections: sections(parsed),
          })),
          sections: sections(first.parsed),
          valid: true,
        },
        checked
          .flatMap(({ component, file, parsed }) => [
            `✓ ${shown(file)}${component === undefined ? "" : ` (component ${component})`} is valid. It describes:`,
            ...review(parsed).map(([label, value]) => `  ${label}: ${value}`),
          ])
          .join("\n")
      );
    }),
  summary: "Check the configuration for mistakes.",
});

const pullCommand = config.ensure({
  description:
    "Write a store's configuration to the project's file (Configurator's introspect). When the file exists, the plan says in words what changed in the store since; replacing it asks first, since edits not yet deployed are lost. The store is remembered in saleor.yml.",
  examples: [
    {
      command: "saleor config pull local:demo",
      description: "Start a project from a local store",
    },
    {
      command: "saleor config pull staging --dry-run",
      description: "See what changed in staging since the last pull",
    },
  ],
  inputs: {
    config: configInput,
    env: envInput,
  },
  name: "pull",
  plan: (input) =>
    Effect.gen(function* () {
      const file = configFile(input.config);

      const client = yield* connect(input.env);

      const existing = existsSync(file) ? readFileSync(file, "utf-8") : null;

      // What the store changed, seen from the file. None when the file cannot be
      // compared (it is invalid, maybe mid-edit): what it would lose is unknown.
      const compared =
        existing === null
          ? Option.some([])
          : yield* diff(client, file).pipe(
              Effect.map((summary) => Option.some(summary.results.map(change))),
              Effect.orElseSucceed(() => Option.none())
            );

      const changed = Option.getOrElse(compared, () => []);

      const pulled = yield* pull(client);
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

          yield* recordDeploy(file, client.store.ref);
          const remembered = yield* remember(file, client.store);

          return {
            data: {
              changes: changed,
              config: shown(file),
              created: existing === null,
              sections: sections(pulled),
              store: client.store.ref,
              written: !same,
            },
            headline: same
              ? `${shown(file)} already matches ${client.store.ref}.`
              : `Wrote ${shown(file)} from ${client.store.ref}.`,
            text: [
              ...changed.map((each) => `  • ${pulledSentence(each)}`),
              ...(existing === null
                ? review(pulled).map(([label, value]) => `  ${label}: ${value}`)
                : []),
              ...(remembered === undefined ? [] : [remembered]),
            ].join("\n"),
          };
        }),
        details: { config: shown(file), store: client.store.ref },
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
          ["Store", client.store.ref],
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
  summary: "Save a store's current configuration.",
});

const diffCommand = config.list({
  description:
    "Show how a store differs from the configuration: one row per entity, and whether a deploy changes it. Compares every file the project deploys (its own, then each component's), or the --config file. Deploys create and update; they never delete, and never update categories. Changes nothing. Exits 0 either way.",
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
    config: deployedInput,
    env: envInput,
  },
  name: "diff",
  run: (input) =>
    Effect.gen(function* () {
      const files = yield* checkedFiles(input.config);

      const client = yield* connect(input.env);

      const rows = yield* Effect.forEach(files, ({ file }) =>
        Effect.map(diff(client, file), (summary) =>
          summary.results.map(change).map((each) => ({
            ...each,
            config: shown(file),
            deploy: applies(each),
          }))
        )
      );

      return listing(
        rows.flat(),
        [
          ...(files.length > 1
            ? [
                [
                  "FILE",
                  (each: { readonly config: string }) => each.config,
                ] as const,
              ]
            : []),
          ["CHANGE", (each) => each.operation],
          ["ENTITY", (each) => each.entity],
          ["NAME", (each) => each.name],
          ["DEPLOY", (each) => (each.deploy ? "yes" : "no")],
          [
            "FIELDS",
            (each) => (each.fields.length > 0 ? each.fields.join(", ") : null),
          ],
        ],
        `No differences: ${client.store.ref} matches ${filesShown(files)}.`
      );
    }),
  summary: "Show what a deploy would change.",
});

const statusCommand = config.list({
  description:
    "For each environment in the project's saleor.yml: whether its store matches the configuration (every file the project deploys, or the --config file), and how many changes a deploy would make. Contacts every store. With several environments, SALEOR_TOKEN is not used: each store needs its own saved token.",
  examples: [
    { command: "saleor config status", description: "Check every environment" },
  ],
  inputs: { config: deployedInput },
  name: "status",
  run: (input) =>
    Effect.gen(function* () {
      const project = yield* Option.match(findProject(), {
        onNone: () =>
          fail(
            "NOT_FOUND",
            "Not in a project: there is no saleor.yml here or above.",
            {
              suggestion: `Start one with: ${command("init")}, or from an existing store: ${command("config", "pull")} <ref>`,
            }
          ),
        onSome: Effect.succeed,
      });

      const files = yield* checkedFiles(input.config);

      // SALEOR_TOKEN belongs to one store; with several, each uses its own token.
      const envToken = project.environments.length === 1;

      if (!envToken && process.env.SALEOR_TOKEN?.trim()) {
        yield* notice(
          "SALEOR_TOKEN is not used: this project has several environments, so each uses the token saved for its store."
        );
      }

      // Connecting may ask for a token, so connections take turns; the comparisons,
      // which are the slow part, run side by side.
      const prompts = yield* Semaphore.make(1);

      const rows = yield* Effect.forEach(
        project.environments,
        ([name, ref]) =>
          Effect.gen(function* () {
            const client = yield* prompts.withPermit(
              connect(Option.some(ref), { envToken })
            );

            const plans = yield* Effect.forEach(files, ({ file }) =>
              planDeploy(client, file)
            );

            const deployable = plans.reduce(
              (total, plan) => total + plan.deployable.length,
              0
            );

            // Deployed from here when every file was; as of the oldest of them.
            const synced = Option.all(
              files.map(({ file }) => lastDeploy(file, ref))
            );

            return {
              deployable,
              environment: name,
              lastDeployed: Option.match(synced, {
                onNone: () => null,
                onSome: (notes) =>
                  new Date(
                    Math.min(...notes.map((note) => note.at.getTime()))
                  ).toISOString(),
              }),
              ref,
              saleorVersion: client.store.saleorVersion,
              skipped: plans.reduce(
                (total, plan) => total + plan.skipped.length,
                0
              ),
              state: deployable === 0 ? "in sync" : "changes to deploy",
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
          ),
        { concurrency: "unbounded" }
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
        `This project has no environments yet. Add one with: ${command("env", "add")} <name>`
      );
    }),
  summary: "Check which stores match the configuration.",
});

const guideCommand = config
  .session({
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
  })
  .pipe(Command.annotate(HideFromMenu, true));

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
    "Store configuration as code, with Saleor Configurator's engine. Commands name the store with the word after them, as in every command: an environment from saleor.yml (saleor config deploy staging) or a store ref. Describe changes in plain words with config edit; see where each environment stands with config status. Store API tokens come from SALEOR_TOKEN, a token saved for the store, or a prompt; local stores need none.",
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
      const note = lastDeploy(file, ref);
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
