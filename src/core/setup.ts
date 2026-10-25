import { Effect, Option } from "effect";
import {
  defineActions,
  type Ensured,
  type KindValues,
  type Planned,
  type Values,
} from "./action.ts";
import { type CliFailure, fail } from "./errors.ts";
import {
  type Input,
  type InputValue,
  type InputValues,
  option,
} from "./inputs.ts";
import { askSelect, isInteractive } from "./interaction.ts";
import { command, recordAnswer } from "./invocation.ts";

// `saleor init` is the one journey every provider shares: give me a working store.
// Each module that can run a store contributes a setup provider; this file composes
// them without knowing any of them. One provider is the default; each other one is
// chosen with its own flag (`--local`), with one of its own flags, or at a prompt.

type Inputs = Readonly<Record<string, Input<InputValue>>>;

export interface SetupResult {
  readonly created: boolean;
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
  readonly plan: (
    input: InputValues & KindValues
  ) => Effect.Effect<Planned<Ensured<SetupResult>, R>, CliFailure, R>;
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
  readonly plan: (
    input: Values<I> & KindValues
  ) => Effect.Effect<Planned<Ensured<A>, RA>, CliFailure, R>;
}): SetupProvider<R | RA> => ({
  before: provider.before ?? Effect.void,
  example: provider.example,
  flag: provider.flag,
  hint: provider.hint,
  inputs: provider.inputs,
  label: provider.label,
  name: provider.name,
  plan: (input) =>
    // SAFETY: `init` declares every provider's inputs on one command and passes the parsed record, so the keys of `I` hold the values its inputs parse to.
    provider.plan(input as Values<I> & KindValues),
});

const isSet = (value: InputValue | undefined) =>
  Option.isOption(value) ? Option.isSome(value) : value === true;

export const setupCommand = <R>(providers: readonly SetupProvider<R>[]) => {
  const [fallback, ...others] = [
    ...providers.filter((p) => p.flag === undefined),
    ...providers.filter((p) => p.flag !== undefined),
  ];

  if (fallback === undefined || fallback.flag !== undefined) {
    throw new Error("Exactly one setup provider must be the default.");
  }

  const selectors: Record<string, Input<boolean>> = Object.fromEntries(
    others.map((p) => [
      p.flag ?? p.name,
      option.boolean(
        p.flag ?? p.name,
        `Set up with ${p.label} (${p.hint}) instead of ${fallback.label}.`
      ),
    ])
  );

  const merged = new Map<string, Input<InputValue>>(Object.entries(selectors));

  for (const provider of providers) {
    for (const [key, input] of Object.entries(provider.inputs)) {
      if (merged.has(key)) {
        throw new Error(`Setup input "${key}" is declared twice.`);
      }

      merged.set(key, input);
    }
  }

  const inputs = Object.fromEntries(merged);

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
          `Choose one of ${selected.map((p) => `--${p.flag}`).join(", ")}.`
        )
      );
    }

    const [chosen] = selected;
    const clashing = typed.filter((p) => p !== chosen);

    if (clashing.length === 0 || (chosen === undefined && typed.length === 1)) {
      return Effect.succeed(chosen ?? typed[0]);
    }

    const parts = [
      ...(chosen === undefined ? [] : [`--${chosen.flag}`]),
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
  // exported SALEOR_ORG is not a request for Cloud.
  const choose = (input: InputValues) =>
    Effect.gen(function* () {
      const chosen = yield* requireOneProvider(
        input,
        others.filter((p) => input[p.flag ?? p.name] === true),
        providers.filter((p) => typedBy(p, input).length > 0)
      );

      if (chosen !== undefined) {
        return { explicit: true, provider: chosen };
      }

      if (!(yield* isInteractive)) {
        return { explicit: false, provider: fallback };
      }

      const name = yield* askSelect({
        choices: providers.map((p) => ({
          hint: p.hint,
          label: p.label,
          value: p.name,
        })),
        message: "Where should the store run?",
      });

      const picked = providers.find((p) => p.name === name) ?? fallback;

      if (picked.flag !== undefined) {
        yield* recordAnswer({ flag: `--${picked.flag}` });
      }

      return { explicit: true, provider: picked };
    });

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
    description: `Create or reuse a working Saleor store and print how to reach it. Uses ${fallback.label} by default${others.map((p) => `; pass --${p.flag} for ${p.label}`).join("")}. In a terminal, it asks for anything missing. Does not scaffold application code. Safe to run again after an interruption.`,
    examples: providers.map((p) => p.example),
    inputs,
    name: "init",
    plan: (input) =>
      Effect.gen(function* () {
        const { explicit, provider } = yield* choose(input);
        yield* provider.before;

        return yield* provider
          .plan(input)
          .pipe(Effect.mapError(explicit ? (e) => e : otherProviders));
      }),
    summary: `Set up a Saleor store in ${[fallback, ...others].map((p) => p.label).join(" or ")}.`,
    waits: true,
  });
};
