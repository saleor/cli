import { Effect, Option, type Schema } from "effect";
import { isGiven, named } from "./target.ts";
import {
  changes,
  defineActions,
  type Ensured,
  type KindValues,
  type Plan,
  type Planned,
  type Values,
} from "./action.ts";
import { type CommandResult, result } from "./command.ts";
import { type CliFailure, fail } from "./errors.ts";
import {
  type Input,
  type InputValue,
  type InputValues,
  option,
} from "./inputs.ts";
import type { Store } from "./store.ts";
import { askSelect, isInteractive } from "./interaction.ts";
import { command, recordAnswer } from "./invocation.ts";
import { askThen } from "./navigation.ts";
import { notice } from "./output.ts";
import { projectFolder } from "./project.ts";
import { initializeProject } from "./project-init.ts";

// `saleor init` is the one journey every provider shares: create a new store.
// Each module that can run a store contributes a setup provider; this file composes
// them without knowing any of them. One provider is the default; each other one is
// chosen with its own flag (`--local`), with one of its own flags, or at a prompt.

type Inputs = Readonly<Record<string, Input<InputValue>>>;

// Every provider sets up a store, so its result is one: a store (see store.ts).
export interface SetupResult extends Store {
  readonly created: boolean;
  readonly sampleDataReady?: boolean | undefined;
}

export interface SetupProvider<R> {
  readonly before: Effect.Effect<void, CliFailure, R>;
  readonly example: { readonly command: string; readonly description: string };
  // The flag that selects it; the default provider has none.
  readonly flag: string | undefined;
  readonly hint: string;
  readonly inputs: Inputs;
  readonly label: string;
  readonly name: string;
  // How `env add <name>` names the store it sets up for a project's environment.
  readonly naming: Naming;
  // How first-run onboarding offers this place to run stores.
  readonly onboarding: OnboardingPath | undefined;
  readonly plan: (
    input: InputValues & KindValues
  ) => Effect.Effect<Planned<Ensured<SetupResult>, R>, CliFailure, R>;
  readonly requirement: Requirement<R> | undefined;
}

// What onboarding says about a place to run stores, and what it does when picked.
export interface OnboardingPath {
  // Something a coding agent can get on this path besides skills, such as Saleor MCP.
  readonly agentTool?: AgentTool | undefined;
  // A command run first, such as `login`; onboarding stops when it fails.
  readonly first?: readonly string[] | undefined;
  readonly hint: string;
  readonly label: string;
  // What the store onboarding offers to set up will be.
  readonly store: string;
}

export interface AgentTool {
  readonly install: (agent: string) => Effect.Effect<void>;
  // Said before the question.
  readonly offer: string;
  readonly question: string;
}

export interface Naming {
  // The input that takes the store's name, which `env add` fills in instead.
  readonly input: string;
  // The store's name for environment `environment` of project `project`.
  readonly name: (project: string, environment: string) => string;
}

// Something a provider needs before it can set up a store, such as a Cloud login.
// While unmet, `init` still offers the provider, after the others and with this hint.
export interface Requirement<R> {
  readonly hint: string;
  readonly met: Effect.Effect<boolean, never, R>;
  // Printed before the question when there is something to say, such as the account
  // the provider would use.
  readonly status?: Effect.Effect<string | undefined, never, R>;
}

export const defineSetup = <
  I extends Inputs,
  A extends SetupResult,
  R,
  RA,
>(provider: {
  readonly before?: Effect.Effect<void, CliFailure, R>;
  readonly example: { readonly command: string; readonly description: string };
  readonly flag?: string;
  readonly hint: string;
  readonly inputs: I;
  readonly label: string;
  readonly name: string;
  readonly naming: Naming & { readonly input: keyof I & string };
  readonly onboarding?: OnboardingPath;
  readonly plan: (
    input: Values<I> & KindValues
  ) => Effect.Effect<Planned<Ensured<A>, RA>, CliFailure, R>;
  readonly requirement?: Requirement<R>;
}): SetupProvider<R | RA> => ({
  before: provider.before ?? Effect.void,
  example: provider.example,
  flag: provider.flag,
  hint: provider.hint,
  inputs: provider.inputs,
  label: provider.label,
  name: provider.name,
  naming: provider.naming,
  onboarding: provider.onboarding,
  plan: (input) =>
    // SAFETY: `init` declares every provider's inputs on one command and passes the parsed record, so the keys of `I` hold the values its inputs parse to.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The combined command parses these exact provider inputs before invoking this adapter.
    provider.plan(input as Values<I> & KindValues),
  requirement: provider.requirement,
});

// Something more `init` sets up next to the store, such as a storefront. Its questions
// come after the provider's, once everything needed for the store is known; it works
// with whichever store the provider made, so it knows no provider.
export interface SetupExtension<R> {
  // A sentence for `init`'s description: what it adds and how to ask for it.
  readonly description: string;
  readonly inputs: Inputs;
  // None when it is not wanted this time.
  readonly plan: (
    input: InputValues & KindValues,
    store: Plan
  ) => Effect.Effect<Option.Option<ExtensionPlan<R>>, CliFailure, R>;
}

export interface ExtensionPlan<R> {
  readonly apply: (
    store: SetupResult
  ) => Effect.Effect<CommandResult<unknown>, CliFailure, R>;
  // Whether applying it changes anything.
  readonly changes: boolean;
  readonly details: Schema.Json;
  // Its key in the result and the plan's details: "storefront".
  readonly name: string;
  // Work that does not need the store, done while the store is being set up.
  readonly prepare: Effect.Effect<void, CliFailure, R>;
  readonly summary: readonly (readonly [label: string, value: string])[];
}

export const defineSetupExtension = <I extends Inputs, R, RA>(extension: {
  readonly description: string;
  readonly inputs: I;
  readonly plan: (
    input: Values<I> & KindValues,
    store: Plan
  ) => Effect.Effect<Option.Option<ExtensionPlan<RA>>, CliFailure, R>;
}): SetupExtension<R | RA> => ({
  description: extension.description,
  inputs: extension.inputs,
  plan: (input, store) =>
    // SAFETY: as in defineSetup, `init` declares these inputs and passes the parsed record.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The combined command parses these exact extension inputs before invoking this adapter.
    extension.plan(input as Values<I> & KindValues, store),
});

// The store's plan with the extensions' work added: the store is set up while they
// prepare, then each one finishes with the store, and its result sits under its name.
const extend = <R>(
  store: Planned<Ensured<SetupResult>, R>,
  extensions: readonly ExtensionPlan<R>[]
): Planned<Ensured<SetupResult>, R> => {
  const projectName = Option.getOrElse(
    Option.fromUndefinedOr(store.target.scope.project),
    () => store.target.name
  );

  const root = projectFolder(projectName);

  const extra = extensions.some((extension) => extension.changes);

  return {
    ...store,
    // A store that exists already is still "updated" when something is added to it.
    action: extra && !changes(store) ? "update" : store.action,
    apply: Effect.gen(function* () {
      // A preparation is not interrupted when the store fails or stops waiting, so a
      // download is never left half-written; running `init` again picks it up.
      const [ready, ...prepared] = yield* Effect.all(
        [
          Effect.exit(store.apply),
          ...extensions.map((extension) => Effect.exit(extension.prepare)),
        ],
        { concurrency: "unbounded" }
      );

      const ensured = yield* ready;
      yield* initializeProject(root, projectName, ensured.data);

      for (const exit of prepared) {
        yield* exit;
      }

      const outcomes = yield* Effect.forEach(extensions, (extension) =>
        Effect.map(extension.apply(ensured.data), (outcome) => ({
          name: extension.name,
          outcome,
        }))
      );

      return {
        ...result(
          {
            ...ensured.data,
            ...Object.fromEntries(
              outcomes.map(({ name, outcome }) => [name, outcome.data])
            ),
          },
          [
            ensured.text,
            ...outcomes.flatMap(({ outcome }) => ["", outcome.text]),
          ].join("\n")
        ),
        target: ensured.target,
      };
    }),
    details: Object.fromEntries([
      ...Object.entries(store.details),
      ...extensions.map(
        (extension) => [extension.name, extension.details] as const
      ),
    ]),
    summary: [
      ...(store.summary ?? []),
      ...extensions.flatMap((extension) => extension.summary),
    ],
  };
};

const isSet = (value: InputValue | undefined) => {
  if (isGiven(value)) {
    return named(value);
  }

  return Option.isOption(value) ? Option.isSome(value) : value === true;
};

// The flag that names a provider on the command line: its own (`--local`), or its
// name for the default one (`--cloud`), which is used without it outside a terminal.
export const selectorOf = (
  provider: Pick<SetupProvider<unknown>, "flag" | "name">
) => provider.flag ?? provider.name;

// Which provider sets up a store, shared by `init` and `env add`: the default one,
// a flag for each provider (`--cloud`, `--local`), and the rules below for choosing.
export const providerChoice = <R>(providers: readonly SetupProvider<R>[]) => {
  const [fallback, ...others] = [
    ...providers.filter((p) => p.flag === undefined),
    ...providers.filter((p) => p.flag !== undefined),
  ];

  if (fallback === undefined || fallback.flag !== undefined) {
    throw new Error("Exactly one setup provider must be the default.");
  }

  const selectors: Record<string, Input<boolean>> = Object.fromEntries(
    [fallback, ...others].map((p) => [
      selectorOf(p),
      option.boolean(
        selectorOf(p),
        p === fallback
          ? `Set up with ${p.label} (${p.hint}), the default, without asking where in a terminal.`
          : `Set up with ${p.label} (${p.hint}) instead of ${fallback.label}.`
      ),
    ])
  );

  return {
    fallback,
    others,
    selectors,
    ...providerSelection(providers, fallback),
  };
};

const providerSelection = <R>(
  providers: readonly SetupProvider<R>[],
  fallback: SetupProvider<R>
) => {
  const typedBy = (provider: SetupProvider<R>, input: InputValues) =>
    Object.entries(provider.inputs)
      .filter(([key]) => isSet(input[key]))
      .map(([, value]) => `--${value.build("ensure").name}`);

  // Flags of more than one provider: say which ones clash.
  const requireOneProvider = (
    input: InputValues,
    selected: readonly SetupProvider<R>[],
    typed: readonly SetupProvider<R>[]
  ) => {
    if (selected.length > 1) {
      return Effect.fail(
        fail(
          "USAGE_ERROR",
          `Choose one of ${selected.map((p) => `--${selectorOf(p)}`).join(", ")}.`
        )
      );
    }

    const [chosen] = selected;
    const clashing = typed.filter((p) => p !== chosen);

    if (clashing.length === 0 || (chosen === undefined && typed.length === 1)) {
      return Effect.succeed(chosen ?? typed[0]);
    }

    const parts = [
      ...(chosen === undefined ? [] : [`--${selectorOf(chosen)}`]),
      ...clashing.map(
        (p) => `${p.label} flags (${typedBy(p, input).join(", ")})`
      ),
    ];

    return Effect.fail(
      fail("USAGE_ERROR", `${parts.join(" and ")} cannot be combined.`, {
        suggestion: `Choose one: ${providers.map((p) => p.example.command).join(", or ")}.`,
      })
    );
  };

  // Which provider: its own flag, else whichever provider's flags were typed, else a
  // person's choice, else the default. Environment variables never choose: an
  // exported SALEOR_ORG is not a request for Cloud. None when the person is asked.
  const decided = (input: InputValues) =>
    Effect.gen(function* () {
      const chosen = yield* requireOneProvider(
        input,
        providers.filter((p) => input[selectorOf(p)] === true),
        providers.filter((p) => typedBy(p, input).length > 0)
      );

      if (chosen !== undefined) {
        return Option.some({ explicit: true, provider: chosen });
      }

      return (yield* isInteractive)
        ? Option.none()
        : Option.some({ explicit: false, provider: fallback });
    });

  const ask = Effect.gen(function* () {
    // Always asked: a Cloud login does not mean every new store belongs in Cloud.
    // Providers ready to use come first, so the likely answer is preselected.
    const offers = yield* Effect.forEach(providers, (provider) => {
      const { requirement } = provider;

      return requirement === undefined
        ? Effect.succeed({ hint: provider.hint, provider, ready: true })
        : Effect.map(requirement.met, (met) => ({
            hint: met ? provider.hint : requirement.hint,
            provider,
            ready: met,
          }));
    });

    for (const provider of providers) {
      const status = yield* provider.requirement?.status ?? Effect.void;

      if (status !== undefined) {
        yield* notice(status);
      }
    }

    const name = yield* askSelect({
      choices: [
        ...offers.filter((offer) => offer.ready),
        ...offers.filter((offer) => !offer.ready),
      ].map(({ hint, provider }) => ({
        hint,
        label: provider.label,
        value: provider.name,
      })),
      message: "Where should the new store run?",
    });

    const picked = providers.find((p) => p.name === name) ?? fallback;

    if (picked.flag !== undefined) {
      yield* recordAnswer({ flag: `--${picked.flag}` });
    }

    return { explicit: true, provider: picked };
  });

  return { decided, ask };
};

export const setupCommand = <R>(
  providers: readonly SetupProvider<R>[],
  extensions: readonly SetupExtension<R>[] = []
) => {
  const { fallback, others, selectors, decided, ask } =
    providerChoice(providers);

  const merged = new Map<string, Input<InputValue>>(Object.entries(selectors));

  for (const owner of [...providers, ...extensions]) {
    for (const [key, input] of Object.entries(owner.inputs)) {
      if (merged.has(key)) {
        throw new Error(`Setup input "${key}" is declared twice.`);
      }

      merged.set(key, input);
    }
  }

  const inputs = Object.fromEntries(merged);

  // A store that could not be resolved without questions might have been meant for
  // another provider: say how to ask for it.
  const otherProviders = (failure: CliFailure) =>
    failure.code === "CONTEXT_MISSING"
      ? fail(failure.code, failure.message, {
          details: failure.details,
          suggestion: [
            failure.suggestion,
            ...others.map(
              (p) => `For ${p.label}, run: ${command("init", `--${p.flag}`)}`
            ),
          ]
            .filter(Boolean)
            .join("\n"),
        })
      : failure;

  return defineActions().ensure({
    description: `Create a Saleor store and print how to reach it. Uses ${fallback.label} by default${others.map((p) => `; pass --${p.flag} for ${p.label}`).join("")}. In a terminal, it asks for anything missing. ${extensions.length === 0 ? "Does not scaffold application code." : extensions.map((e) => e.description).join(" ")} An explicitly named store is reused so setup can be retried after an interruption.`,
    examples: providers.map((p) => p.example),
    inputs,
    name: "init",
    plan: (input) =>
      Effect.gen(function* () {
        const planWith = ({
          explicit,
          provider,
        }: {
          readonly explicit: boolean;
          readonly provider: (typeof providers)[number];
        }) =>
          Effect.gen(function* () {
            yield* provider.before;

            const store = yield* provider
              .plan(input)
              .pipe(Effect.mapError(explicit ? (e) => e : otherProviders));

            const extra = yield* Effect.forEach(extensions, (extension) =>
              extension.plan(input, store)
            );

            return extend(store, extra.flatMap(Option.toArray));
          });

        // Escape in a provider's own questions returns to where the store should run.
        return yield* Option.match(yield* decided(input), {
          onNone: () => askThen(ask, planWith),
          onSome: planWith,
        });
      }),
    summary: `Create a Saleor store in ${[fallback, ...others].map((p) => p.label).join(" or ")}.`,
    waits: true,
  });
};
