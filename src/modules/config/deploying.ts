import { Effect, Option } from "effect";
import { existsSync } from "node:fs";
import path from "node:path";
import { fail } from "../../core/errors.ts";
import type { Instance } from "../../core/instance.ts";
import { findProject, recordInSync } from "../../core/project.ts";
import { applies, sentence, why } from "./describe.ts";
import {
  type Change,
  change,
  deploy,
  diff,
  shown,
  type Store,
} from "./engine.ts";

// A deploy plan: the differences, split into what a deploy changes and what it
// leaves as it is, so a plan never promises what the engine will not do.
export const planDeploy = (store: Store, file: string) =>
  Effect.map(diff(store, file), (summary) => {
    const changes = summary.results.map(change);

    return {
      changes,
      deployable: changes.filter(applies),
      skipped: changes.filter((each) => !applies(each)),
      summary,
    };
  });

export type DeployPlan = Effect.Success<ReturnType<typeof planDeploy>>;

export const counted = (changes: readonly Change[], done = false) => {
  const count = (operation: Change["operation"]) =>
    `${changes.filter((each) => each.operation === operation).length} ${done ? `${operation}d` : `to ${operation}`}`;

  return `${count("create")}, ${count("update")}`;
};

const SHOWN = 12;

// Rows a person reads before confirming: each change as a sentence, then what is
// left as it is and why.
export const planRows = (plan: DeployPlan) => [
  ...plan.deployable
    .slice(0, SHOWN)
    .map((each) => ["", `• ${sentence(each)}`] as const),
  ...(plan.deployable.length > SHOWN
    ? [["", `… and ${plan.deployable.length - SHOWN} more`] as const]
    : []),
  ...(plan.skipped.length > 0
    ? [
        ["Left as is", `${plan.skipped.length}`] as const,
        ...plan.skipped
          .slice(0, SHOWN)
          .map((each) => ["", `◦ ${sentence(each)}: ${why(each)}`] as const),
      ]
    : []),
];

const key = (each: Change) => `${each.operation}\0${each.entity}\0${each.name}`;

// Applies the plan, then compares again: the engine reports success for changes it
// skips, so what happened is measured, not assumed.
export const applyDeploy = ({
  instance,
  store,
  file,
  plan,
}: {
  readonly instance: Instance;
  readonly store: Store;
  readonly file: string;
  readonly plan: DeployPlan;
}) =>
  Effect.gen(function* () {
    if (plan.deployable.length === 0) {
      yield* recordInSync(file, instance.ref);

      return { applied: [], durationMs: 0, missed: [], skipped: plan.skipped };
    }

    const pass = (summary: DeployPlan["summary"]) =>
      Effect.gen(function* () {
        const { exitCode, result: outcome } = yield* deploy(
          store,
          file,
          summary
        );

        if (exitCode !== 0 || outcome.overallStatus !== "success") {
          const failed = outcome.stages.filter(
            (stage) => stage.status !== "success" && stage.status !== "skipped"
          );

          return yield* fail(
            "DEPLOY_PARTIAL",
            [
              `The deploy to ${instance.ref} ${outcome.overallStatus === "partial" ? "partly failed" : "failed"}.`,
              ...failed.map(
                (stage) => `  ${stage.name}: ${stage.error ?? stage.status}`
              ),
            ].join("\n"),
            {
              details: {
                exitCode,
                stages: outcome.stages,
                summary: outcome.summary,
              },
              suggestion: `Fix the cause, then deploy again; it retries what is left. See what is left with: saleor config diff ${instance.ref}`,
            }
          );
        }

        return outcome.totalDuration;
      });

    let durationMs = yield* pass(plan.summary);
    let again = yield* planDeploy(store, file);

    // The engine runs its stages in a fixed order, so a change can depend on one made
    // later in the same run (a collection is created before its products). One more
    // pass picks those up; what is still left after it, the engine does not do.
    if (again.deployable.length > 0) {
      durationMs += yield* pass(again.summary);
      again = yield* planDeploy(store, file);
    }

    const left = new Set(again.changes.map(key));
    const applied = plan.deployable.filter((each) => !left.has(key(each)));

    if (again.deployable.length === 0) {
      yield* recordInSync(file, instance.ref);
    }

    return {
      applied,
      durationMs,
      missed: again.deployable,
      skipped: again.skipped,
    };
  });

export type Deployed = Effect.Success<ReturnType<typeof applyDeploy>>;

// A deploy's result in words, with a hint when a storefront in the project may
// want a channel the deploy created.
export const deployedText = (
  instance: Instance,
  file: string,
  outcome: Deployed
) => {
  const storefront = Option.match(findProject(path.dirname(file)), {
    onNone: () => false,
    onSome: (project) =>
      existsSync(path.join(project.root, "storefront", ".env")),
  });

  const channels = outcome.applied.filter(
    (each) => each.entity === "Channels" && each.operation === "create"
  );

  return {
    headline:
      outcome.applied.length === 0 && outcome.missed.length === 0
        ? `${instance.ref} already matches ${shown(file)}; nothing to deploy.`
        : `Deployed ${shown(file)} to ${instance.ref}: ${counted(outcome.applied, true)}.`,
    text: [
      ...outcome.applied.map((each) => `  • ${sentence(each)}`),
      ...(outcome.missed.length > 0
        ? [
            "Not applied, although planned (the engine skipped them):",
            ...outcome.missed.map((each) => `  ! ${sentence(each)}`),
          ]
        : []),
      ...(outcome.skipped.length > 0
        ? [
            `Left as is: ${outcome.skipped.length} (${outcome.skipped.map((each) => `${sentence(each)}: ${why(each)}`).join("; ")})`,
          ]
        : []),
      ...(storefront && channels.length > 0
        ? [
            `New channel${channels.length > 1 ? "s" : ""}: ${channels.map((each) => each.name).join(", ")}. To show it in the storefront: saleor storefront env --dir storefront --channel ${channels[0]?.name ?? ""}`,
          ]
        : []),
    ].join("\n"),
  };
};
