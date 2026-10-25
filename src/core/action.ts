import { Context, Effect, Option, Predicate, type Schema } from "effect";
import { Command } from "effect/cli";
import { type CommandResult, result, run } from "./command.ts";
import { type CliFailure, fail } from "./errors.ts";
import {
  type Input,
  type InputInfo,
  type InputValue,
  option,
} from "./inputs.ts";
import type { InstanceState } from "./instance.ts";
import { askConfirm, isInteractive, openBrowser } from "./interaction.ts";
import { ActionContext, type ActionKind, rerunCommand } from "./invocation.ts";
import { columns, notice } from "./output.ts";

// Every command is an action of one kind (see ActionKind), declared with the definers
// below. The kind is the policy: which flags exist, whether `--dry-run` previews it,
// when it asks for confirmation, how its result and text are shaped, and what
// `saleor commands --json` says about its safety. A command supplies what is specific
// to it (how to find its target, what to change) and nothing about the rest.

export const DEFAULT_WAIT_SECONDS = 600;

// ── Metadata ─────────────────────────────────────────────────────────────

export interface ActionMeta {
  readonly destructive: boolean;
  // Keyed by how the input is typed: `--flag` or `<argument>`.
  readonly inputs: ReadonlyMap<string, InputInfo>;
  readonly kind: ActionKind;
  readonly warning: string | null;
}

// Stored on the command itself, so it follows the command wherever it is registered.
export class ActionMetadata extends Context.Service<
  ActionMetadata,
  ActionMeta
>()("saleor/ActionMetadata") {}

export const actionMeta = (command: Command.Command.Any) =>
  Context.getOption(command.annotations, ActionMetadata);

// ── Plans ────────────────────────────────────────────────────────────────

// What an `ensure` or `remove` action is about to do. Planning only reads; applying
// changes. A dry run prints the plan; a real run confirms it if needed, then applies it.
export type PlanAction =
  | "create"
  | "reuse"
  | "update"
  | "delete"
  | "stop"
  | "none";

export type ResourceState = InstanceState | "absent" | "exists";

export interface TargetRef {
  // The short unique identifier (environment key, project slug), when it exists.
  readonly id: string | null;
  readonly name: string;
  // Where it lives, outermost first: { organization, project }.
  readonly scope: Readonly<Record<string, string>>;
  readonly type: string;
}

export interface Plan {
  readonly action: PlanAction;
  // Facts the preview shows: plan, region, service…
  readonly details: Readonly<Record<string, Schema.Json>>;
  // Something a person should know before it happens, such as that it may be billed.
  // Shown once, right before the change; never a reason to ask.
  readonly notice?: string | undefined;
  // What is lost, when this needs confirmation. Null when it is safe.
  readonly risk: string | null;
  readonly state: ResourceState;
  // Labelled facts describing the plan to a person, shown before they confirm.
  readonly summary?: ReadonlyArray<readonly [label: string, value: string]>;
  readonly target: TargetRef;
}

// A plan and the work that carries it out. `apply` only runs after the plan was
// previewed (never, in a dry run) or confirmed.
export interface Planned<A, R> extends Plan {
  readonly apply: Effect.Effect<A, CliFailure, R>;
}

// The plan of a `remove` whose target does not exist. Deleting or stopping what is not
// there succeeds and changes nothing, so retries and cleanups are safe.
export const absent = (target: TargetRef): Planned<object, never> => ({
  action: "none",
  apply: Effect.succeed({}),
  details: {},
  risk: null,
  state: "absent",
  target,
});

const VERBS = {
  create: ["create", "created", "creating"],
  delete: ["delete", "deleted", "deleting"],
  none: ["change", "changed", "changing"],
  reuse: ["reuse", "reused", "reusing"],
  stop: ["stop", "stopped", "stopping"],
  update: ["update", "updated", "updating"],
} as const satisfies Record<PlanAction, readonly [string, string, string]>;

export const changes = (plan: Plan) =>
  plan.action !== "none" && plan.action !== "reuse";

const capitalize = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export const describeTarget = (target: TargetRef) => {
  const id =
    target.id !== null && target.id !== target.name ? ` (${target.id})` : "";

  const scope = Object.values(target.scope);

  // Types are tokens ("local-instance"); a person reads them as words.
  return `${target.type.replaceAll("-", " ")} "${target.name}"${id}${scope.length > 0 ? ` in ${scope.join(" / ")}` : ""}`;
};

// ── Confirmation ─────────────────────────────────────────────────────────

// A plan's facts as aligned "Label: value" lines. Its state is a fact too, except for
// something about to be created, which has none yet; its notice comes last.
const planFields = (plan: Plan) => {
  const fields = [
    ...(plan.state === "absent" ? [] : [["State", plan.state] as const]),
    ...(plan.summary ?? []),
    ...(plan.notice === undefined || !changes(plan)
      ? []
      : [["Note", plan.notice] as const]),
  ];

  const width = Math.max(0, ...fields.map(([label]) => label.length)) + 1;

  return fields.map(
    ([label, value]) => `  ${`${label}:`.padEnd(width)} ${value}`
  );
};

// Declined: nothing changed. Questions answered so far are not lost; the hint carries
// them, so the same command can be finished later without asking again.
const cancelled = Effect.gen(function* () {
  const { answers } = yield* ActionContext;

  return yield* fail(
    "CANCELLED",
    "Cancelled. Nothing was changed.",
    answers.length === 0
      ? {}
      : { suggestion: `To do it later, run: ${yield* rerunCommand()}` }
  );
});

// The one confirmation rule. A plan with a risk (data that is lost) needs `--force` or
// a "yes" at a terminal; without a terminal it is refused. A plan that creates
// something after questions were answered is shown for review first, so a person sees
// the whole result of their answers before anything is created. A notice is shown
// once before the change: in that review, or on its own when there is none.
// Data that would be lost: `--force`, a "yes" at a terminal, or a refusal.
const confirmLoss = (plan: Plan, risk: string) =>
  Effect.gen(function* () {
    const [verb, , gerund] = VERBS[plan.action];
    const what = describeTarget(plan.target);

    if ((yield* ActionContext).force) {
      return;
    }

    if (!(yield* isInteractive)) {
      return yield* fail(
        "CONFIRMATION_REQUIRED",
        `Not ${gerund} ${what} without confirmation. ${risk}`,
        {
          details: { action: plan.action, risk, target: plan.target },
          suggestion: `To confirm, run: ${yield* rerunCommand({ add: ["--force"] })}`,
        }
      );
    }

    if (!(yield* askConfirm(`${capitalize(verb)} ${what}? ${risk}`, false))) {
      return yield* cancelled;
    }
  });

const confirm = (plan: Plan) =>
  Effect.gen(function* () {
    if (!changes(plan)) {
      return;
    }

    if (plan.risk !== null) {
      return yield* confirmLoss(plan, plan.risk);
    }

    if (plan.action === "create" && (yield* ActionContext).answers.length > 0) {
      yield* notice(
        [
          "",
          `  Will ${VERBS[plan.action][0]} ${describeTarget(plan.target)}.`,
          ...planFields(plan),
          "",
        ].join("\n")
      );

      if (!(yield* askConfirm("Continue?", true))) {
        return yield* cancelled;
      }

      return;
    }

    if (plan.notice !== undefined) {
      yield* notice(plan.notice);
    }
  });

// ── Kind-owned inputs ────────────────────────────────────────────────────

export interface KindValues {
  readonly dryRun: boolean;
  readonly force: boolean;
  readonly timeout: number;
}

const dryRunInput = option.boolean(
  "dry-run",
  "Show what would happen without changing anything or asking questions."
);

const forceInput = option.boolean(
  "force",
  "Delete without asking. Required to delete when not running in a terminal."
);

const waitInput = (kind: ActionKind) =>
  option.integer("timeout", {
    default: DEFAULT_WAIT_SECONDS,
    description:
      kind === "remove"
        ? "Seconds to wait until it is gone; 0 returns once the deletion is accepted. The deletion continues after that: run the same command again to keep waiting (exit code 75 until then)."
        : "Seconds to wait until it is ready; 0 checks once. Work done by this process itself, such as downloading images, is not counted. The setup continues after that: run the same command again to keep waiting (exit code 75 until then).",
    metavar: "seconds",
    minimum: 0,
  });

// ── Definitions ──────────────────────────────────────────────────────────

type Inputs = Readonly<Record<string, Input<InputValue>>>;

export type Values<I extends Inputs> = {
  readonly [K in keyof I]: I[K] extends Input<infer A> ? A : never;
};

export interface Example {
  readonly command: string;
  readonly description: string;
}

interface ActionSpec<I extends Inputs> {
  readonly description: string;
  readonly examples?: readonly Example[];
  readonly inputs: I;
  readonly name: string;
  // One line, for listings and menus.
  readonly summary: string;
}

// A list's items with how to show them: the item type comes from `items`.
export interface Listing<Item> {
  readonly columns: ReadonlyArray<
    readonly [header: string, cell: (item: Item) => string | null]
  >;
  readonly empty: string;
  readonly items: readonly Item[];
}

export const listing = <Item>(
  items: readonly Item[],
  cells: Listing<Item>["columns"],
  empty: string
): Listing<Item> => ({ columns: cells, empty, items });

export interface ListSpec<I extends Inputs, Item, R> extends ActionSpec<I> {
  readonly run: (
    input: Values<I>
  ) => Effect.Effect<Listing<Item>, CliFailure, R>;
}

export interface SessionSpec<I extends Inputs, A, R> extends ActionSpec<I> {
  readonly run: (
    input: Values<I>
  ) => Effect.Effect<CommandResult<A>, CliFailure, R>;
}

interface ChangeSpec<I extends Inputs, A, R, RA> extends ActionSpec<I> {
  readonly plan: (
    input: Values<I> & KindValues
  ) => Effect.Effect<Planned<A, RA>, CliFailure, R>;
  // Adds `--timeout`: the action waits for work that continues without the CLI.
  readonly waits?: boolean;
}

// What an ensure's `apply` returns: the resource and the lines describing it, after
// the headline, and the target as it is now when creating it gave it an id.
export interface Ensured<A> extends CommandResult<A> {
  readonly target?: TargetRef | undefined;
}

// `apply` returns the resource and the lines describing it, after the headline.
export type EnsureSpec<
  I extends Inputs,
  A extends { readonly created: boolean },
  R,
  RA,
> = ChangeSpec<I, Ensured<A>, R, RA>;

export interface RemoveResult {
  readonly action: PlanAction;
  readonly existed: boolean;
  readonly target: TargetRef;
}

// `apply` returns fields to add to the result, such as whether it was running.
export interface RemoveSpec<I extends Inputs, X, R, RA>
  extends ChangeSpec<I, X, R, RA> {
  // A line added to the result text, such as how to undo a stop.
  readonly note?: (data: RemoveResult) => string | undefined;
  // What can be lost, for `saleor commands --json`.
  readonly risk: string;
}

export interface Policy<R> {
  // Runs before the action's own work, such as offering a login.
  readonly before?: Effect.Effect<void, CliFailure, R>;
}

// A result that is a store has a dashboard.
const dashboardUrlOf = <D>(data: D) =>
  Predicate.hasProperty(data, "dashboardUrl") &&
  Predicate.isString(data.dashboardUrl)
    ? Option.some(data.dashboardUrl)
    : Option.none();

// After a store is ready, a person at a terminal is offered its dashboard.
const offerDashboard = <D>(data: D) =>
  Effect.gen(function* () {
    const url = dashboardUrlOf(data);

    if (Option.isNone(url) || !(yield* isInteractive)) {
      return;
    }

    if (yield* askConfirm("Open the dashboard?", true)) {
      yield* openBrowser(url.value);
    }
  });

// Why a plan does nothing: what it acts on is absent, or already as asked (a stopped
// instance asked to stop).
const nothingToDo = (plan: Plan) =>
  `${capitalize(describeTarget(plan.target))} ${plan.state === "absent" ? "does not exist" : `is already ${plan.state}`}; nothing to do.`;

const previewText = (plan: Plan) => {
  const what = describeTarget(plan.target);
  const [verb] = VERBS[plan.action];

  let headline = `Dry run: would ${verb} ${what}.`;

  if (plan.action === "none") {
    headline = `Dry run: ${nothingToDo(plan)}`;
  } else if (plan.action === "reuse") {
    headline = `Dry run: would reuse ${what}; nothing changes.`;
  }

  return [
    headline,
    ...planFields(plan),
    ...(changes(plan) && plan.risk !== null
      ? [`  Needs confirmation (--force): ${plan.risk}`]
      : []),
  ].join("\n");
};

const preview = (plan: Plan) =>
  result(
    {
      action: plan.action,
      destructive: changes(plan) && plan.risk !== null,
      details: plan.details,
      dryRun: true as const,
      notice: changes(plan) ? (plan.notice ?? null) : null,
      state: plan.state,
      target: plan.target,
      warning: changes(plan) ? plan.risk : null,
    },
    previewText(plan)
  );

const rerunHint = Effect.gen(function* () {
  const { answers } = yield* ActionContext;

  return answers.length === 0
    ? []
    : [
        "",
        "To run this again without questions:",
        `  ${yield* rerunCommand()}`,
      ];
});

// What a kind implies for one command: its safety and the flags it gets.
interface KindRules {
  readonly destructive: boolean;
  readonly kind: ActionKind;
  readonly waits: boolean;
  readonly warning: string | null;
}

const build = <
  I extends Inputs,
  C extends CommandResult<unknown>,
  R,
  R2 = never,
>(
  rules: KindRules,
  spec: ActionSpec<I>,
  body: (input: Values<I> & KindValues) => Effect.Effect<C, CliFailure, R>,
  afterSuccess?: (data: C["data"]) => Effect.Effect<void, never, R2>
) => {
  const inputs = new Map<string, Input<InputValue>>(
    Object.entries(spec.inputs)
  );

  if (rules.kind === "ensure" || rules.kind === "remove") {
    inputs.set("dryRun", dryRunInput);
  }

  if (rules.kind === "remove") {
    inputs.set("force", forceInput);
  }

  if (rules.waits) {
    inputs.set("timeout", waitInput(rules.kind));
  }

  const built = [...inputs].map(
    ([key, input]) => [key, input.build(rules.kind)] as const
  );

  const meta: ActionMeta = {
    destructive: rules.destructive,
    inputs: new Map(
      built.map(([, input]) => [
        input.positional ? `<${input.name}>` : `--${input.name}`,
        input.info,
      ])
    ),
    kind: rules.kind,
    warning: rules.warning,
  };

  return Command.make(
    spec.name,
    Object.fromEntries(built.map(([key, input]) => [key, input.param])),
    (raw) => {
      // SAFETY: `raw` is parsed from exactly the params built above, keyed the same way, so each key holds its input's value type.
      const values = {
        dryRun: false,
        force: false,
        timeout: DEFAULT_WAIT_SECONDS,
        ...raw,
      } as Values<I> & KindValues;

      return run(body(values), afterSuccess).pipe(
        Effect.provideService(ActionContext, {
          answers: [],
          dryRun: values.dryRun,
          force: values.force,
          kind: rules.kind,
        })
      );
    }
  ).pipe(
    Command.withDescription(spec.description),
    Command.withShortDescription(spec.summary),
    Command.withExamples(spec.examples ?? []),
    Command.annotate(ActionMetadata, meta)
  );
};

const QUIET: KindRules = {
  destructive: false,
  kind: "session",
  waits: false,
  warning: null,
};

// The definers for one module. A module passes its policy once (Cloud offers a login
// before every Cloud action) instead of repeating it in each command.
export const defineActions = <RP = never>(policy: Policy<RP> = {}) => {
  const before = policy.before ?? Effect.void;

  return {
    ensure: <I extends Inputs, A extends { readonly created: boolean }, R, RA>(
      spec: EnsureSpec<I, A, R, RA>
    ) =>
      build(
        {
          destructive: false,
          kind: "ensure",
          waits: spec.waits === true,
          warning: null,
        },
        spec,
        (input) =>
          Effect.gen(function* () {
            yield* before;
            const plan = yield* spec.plan(input);
            const { dryRun } = yield* ActionContext;

            if (dryRun) {
              return preview(plan);
            }

            yield* confirm(plan);
            const { data, target, text } = yield* plan.apply;
            const what = capitalize(describeTarget(target ?? plan.target));

            return result(
              data,
              [
                `✓ ${what} is ready (${data.created ? "created" : "already existed"}).`,
                ...(text === "" ? [] : [text]),
                ...(yield* rerunHint),
              ].join("\n")
            );
          }),
        offerDashboard
      ),

    list: <I extends Inputs, Item, R>(spec: ListSpec<I, Item, R>) =>
      build({ ...QUIET, kind: "list" }, spec, (input) =>
        Effect.gen(function* () {
          yield* before;
          const { columns: cells, empty, items } = yield* spec.run(input);

          return result(
            items,
            items.length === 0
              ? empty
              : columns([
                  cells.map(([header]) => header),
                  ...items.map((item) => cells.map(([, cell]) => cell(item))),
                ])
          );
        })
      ),

    remove: <I extends Inputs, X extends object, R, RA>(
      spec: RemoveSpec<I, X, R, RA>
    ) =>
      build(
        {
          destructive: true,
          kind: "remove",
          waits: spec.waits === true,
          warning: spec.risk,
        },
        spec,
        (input) =>
          Effect.gen(function* () {
            yield* before;
            const plan = yield* spec.plan(input);
            const { dryRun } = yield* ActionContext;

            if (dryRun) {
              return preview(plan);
            }

            yield* confirm(plan);

            const extra = plan.action === "none" ? {} : yield* plan.apply;

            const data: RemoveResult = {
              ...extra,
              action: plan.action,
              existed: plan.state !== "absent",
              target: plan.target,
            };

            const what = describeTarget(plan.target);
            const note = spec.note?.(data);

            return result(
              data,
              [
                plan.action === "none"
                  ? `✓ ${nothingToDo(plan)}`
                  : `✓ ${capitalize(VERBS[plan.action][1])} ${what}.`,
                ...(note === undefined ? [] : [note]),
              ].join("\n")
            );
          })
      ),

    session: <I extends Inputs, A, R>(spec: SessionSpec<I, A, R>) =>
      build(QUIET, spec, (input) => Effect.andThen(before, spec.run(input))),
  };
};

// Command groups: a word with actions under it and no behavior of its own.
export const defineGroup = <
  const Children extends readonly Command.Command.Any[],
>(spec: {
  readonly description: string;
  readonly name: string;
  readonly summary: string;
  readonly actions: Children;
}) =>
  Command.make(spec.name).pipe(
    Command.withDescription(spec.description),
    Command.withShortDescription(spec.summary),
    Command.withSubcommands(spec.actions)
  );
