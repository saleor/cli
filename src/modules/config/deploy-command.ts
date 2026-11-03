import { Effect } from "effect";
import {
  defineActions,
  type Planned,
  type TargetRef,
} from "../../core/action.ts";
import type { Store } from "../../core/store.ts";
import { envInput } from "../../core/stores.ts";
import {
  applyDeploy,
  counted,
  deployedText,
  planDeploy,
  planRows,
} from "./deploying.ts";
import type { Change } from "./engine.ts";
import {
  checkedFiles,
  connect,
  deployedInput,
  filesShown,
  remember,
} from "./store.ts";
import { shown } from "../../core/output.ts";

// `config deploy`: every file the project deploys, one after another, as one plan.

const config = defineActions();

// One headline for a deploy of several files.
const deployedHeadline = (
  store: Store,
  files: readonly { readonly file: string }[],
  {
    applied,
    missed,
  }: { readonly applied: readonly Change[]; readonly missed: number }
) =>
  applied.length === 0 && missed === 0
    ? `${store.ref} already matches ${filesShown(files)}; nothing to deploy.`
    : `Deployed ${filesShown(files)} to ${store.ref}: ${counted(applied, true)}.`;

const storeTarget = (store: Store): TargetRef => ({
  id: store.ref,
  name: store.name,
  scope: {},
  type: "store",
});

export const deployCommand = config.ensure({
  description:
    "Make a store match the configuration: create and update entities until it has what the files say. Deploys every file the project deploys, in order (its own, then each component's, such as the storefront's content), or the --config file. The plan lists each change as a sentence, and what a deploy leaves as it is (it never deletes). After applying, it compares again and reports what actually changed. A partial failure exits with DEPLOY_PARTIAL and stops before the next file; running it again retries what is left.",
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
      command: "SALEOR_TOKEN=… saleor config deploy cloud:acme/env1",
      description: "Deploy from CI with a store token",
    },
  ],
  inputs: {
    config: deployedInput,
    env: envInput,
  },
  name: "deploy",
  plan: (input) =>
    Effect.gen(function* () {
      const files = yield* checkedFiles(input.config);

      const client = yield* connect(input.env);

      const plans = yield* Effect.forEach(files, ({ component, file }) =>
        Effect.map(planDeploy(client, file), (plan) => ({
          component,
          file,
          plan,
        }))
      );

      const deployable = plans.flatMap(({ plan }) => plan.deployable);
      const skipped = plans.flatMap(({ plan }) => plan.skipped);
      const several = plans.length > 1;

      return {
        action: deployable.length === 0 ? "reuse" : "update",
        apply: Effect.gen(function* () {
          // One file after another: a component's content can build on the project's.
          const outcomes = yield* Effect.forEach(plans, ({ file, plan }) =>
            Effect.map(applyDeploy({ client, file, plan }), (outcome) => ({
              file,
              outcome,
              words: deployedText(client.store, file, outcome),
            }))
          );

          const [first] = outcomes;
          const applied = outcomes.flatMap(({ outcome }) => outcome.applied);
          const missed = outcomes.flatMap(({ outcome }) => outcome.missed);

          const remembered =
            first === undefined
              ? undefined
              : yield* remember(first.file, client.store);

          const headline =
            !several && first !== undefined
              ? first.words.headline
              : deployedHeadline(client.store, files, {
                  applied,
                  missed: missed.length,
                });

          return {
            data: {
              applied,
              configs: outcomes.map(({ file, outcome }) => ({
                applied: outcome.applied.length,
                config: shown(file),
                missed: outcome.missed.length,
                skipped: outcome.skipped.length,
              })),
              created: false,
              durationMs: outcomes.reduce(
                (total, { outcome }) => total + outcome.durationMs,
                0
              ),
              missed,
              skipped: outcomes.flatMap(({ outcome }) => outcome.skipped),
              store: client.store.ref,
            },
            headline,
            text: [
              ...outcomes.flatMap(({ words }) =>
                several ? [words.headline, words.text] : [words.text]
              ),
              remembered ?? "",
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }),
        details: {
          config: shown(files[0]?.file ?? ""),
          configs: files.map(({ file }) => shown(file)),
          deployable,
          skipped,
          store: client.store.ref,
        },
        risk: null,
        state: client.store.state,
        summary: [
          ["Store", client.store.ref],
          ...plans.flatMap(({ component, file, plan }) => [
            [
              "File",
              `${shown(file)}${component === undefined ? "" : ` (component ${component})`}`,
            ] as const,
            ["Changes", counted(plan.deployable)] as const,
            ...planRows(plan),
          ]),
        ],
        target: storeTarget(client.store),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Apply the configuration to a store.",
});
