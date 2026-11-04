import { type Option, Schema } from "effect";
import { Argument, Flag } from "effect/cli";
import type { ActionKind } from "./invocation.ts";
import type { Given } from "./target.ts";

// Every flag and argument of a command is declared through these builders. An input
// carries what `saleor commands --json` publishes about it (its default and the
// environment variable that fills it) next to the parser definition, so the two cannot
// drift. Builders take the action kind because some inputs mean something different
// per kind: a deletion never reads its target from the environment.

export type InputDefault = string | number | boolean;

// What a parsed input holds: an optional value, a value with a default, or what was
// given for a target, which only the target resolves (see target.ts).
export type InputValue = Option.Option<string> | InputDefault | Given;

// Parsed inputs, by key, where the keys are only known at run time (`init` combines
// every provider's inputs).
export type InputValues = Readonly<Record<string, InputValue>>;

export interface InputInfo {
  readonly default?: InputDefault;
  readonly env?: string;
  // The noun of the target it names, for inputs declared with `target()`.
  readonly target?: string;
}

export interface BuiltInput<A> {
  readonly info: InputInfo;
  // Flag name without dashes, or the argument's name.
  readonly name: string;
  readonly param: Flag.Flag<A> | Argument.Argument<A>;
  readonly positional: boolean;
}

export interface Input<A> {
  readonly build: (kind: ActionKind) => BuiltInput<A>;
}

export const describeDefault = (description: string, value: InputDefault) =>
  `${description} (default ${value})`;

const flagInput = <A>(
  name: string,
  info: InputInfo,
  param: Flag.Flag<A>
): Input<A> => ({
  build: () => ({ info, name, param, positional: false }),
});

export const option = {
  boolean: (name: string, description: string): Input<boolean> =>
    flagInput(
      name,
      { default: false },
      Flag.Boolean(name).pipe(
        Flag.withDescription(description),
        Flag.withDefault(false)
      )
    ),

  // A whole number of at least `minimum`, with a default the parser applies.
  integer: (
    name: string,
    spec: {
      readonly default: number;
      readonly description: string;
      readonly metavar: string;
      readonly minimum: number;
    }
  ): Input<number> =>
    flagInput(
      name,
      { default: spec.default },
      Flag.Int(name).pipe(
        Flag.withSchema(
          Schema.Int.pipe(
            Schema.check(Schema.isGreaterThanOrEqualTo(spec.minimum))
          )
        ),
        Flag.withMetavar(spec.metavar),
        Flag.withDescription(describeDefault(spec.description, spec.default)),
        Flag.withDefault(spec.default)
      )
    ),

  // An optional value. A `default` is only documented: the command applies it where
  // it is meaningful (a region only matters for a project that is created).
  string: (
    name: string,
    spec: {
      readonly default?: string;
      readonly description: string;
      readonly metavar: string;
    }
  ): Input<Option.Option<string>> =>
    flagInput(
      name,
      spec.default === undefined ? {} : { default: spec.default },
      Flag.String(name).pipe(
        Flag.withMetavar(spec.metavar),
        Flag.withDescription(
          spec.default === undefined
            ? spec.description
            : describeDefault(spec.description, spec.default)
        ),
        Flag.optional
      )
    ),
};

// An optional word after the command, for a value people type often and in full: an
// environment's name, or a description in plain words.
export const argument = {
  string: (
    name: string,
    description: string
  ): Input<Option.Option<string>> => ({
    build: () => ({
      info: {},
      name,
      param: Argument.String(name).pipe(
        Argument.withDescription(description),
        Argument.optional
      ),
      positional: true,
    }),
  }),
};
