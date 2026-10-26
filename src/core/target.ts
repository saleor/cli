import { Effect, Option } from "effect";
import { Argument, Flag } from "effect/cli";
import { type CliFailure, fail } from "./errors.ts";
import type { Input } from "./inputs.ts";
import {
  askSelect,
  askText,
  type Choice,
  isInteractive,
  required,
} from "./interaction.ts";
import { ActionContext, type ActionKind, recordAnswer } from "./invocation.ts";
import { detectAgent } from "./output.ts";

// Every resource a command acts on (an organization, a project, an environment, a
// local instance) is a target, and every target is resolved the same way:
//
//   1. the flag or argument, if given;
//   2. its environment variable, except in `remove` actions, which never act on
//      something the command line does not name;
//   3. in a terminal, a list of the existing ones to pick from (plus "create a new
//      one" in `ensure` actions), never pre-selected, even when there is only one;
//   4. otherwise CONTEXT_MISSING, listing what could have been passed.
//
// Answers given at a prompt are recorded, so hints about what to run next contain them.

export interface TargetDefinition {
  // Validates a value however it arrived; returns the problem, if any.
  readonly check?: (value: string) => string | undefined;
  readonly env?: string;
  // How a value identifies one, for descriptions: "slug or name".
  readonly identifiedBy: string;
  readonly metavar: string;
  readonly name: string;
  readonly noun: string;
}

export interface TargetUsage {
  // Whether the command creates it when it does not exist.
  readonly creates?: boolean;
  // Only narrows what the command shows: never asked for (see `optional`).
  readonly filter?: boolean;
  readonly positional?: boolean;
}

export interface ResolveOptions<R> {
  // The existing targets to pick from, fetched only when they are needed.
  readonly choices: Effect.Effect<readonly Choice<string>[], CliFailure, R>;
  // For targets the command creates: how to ask for a new name.
  readonly create?: {
    readonly label: string;
    readonly initialValue?: string;
    readonly prompt: string;
    // The name used when the answer is left blank; without it, a name is required.
    readonly whenBlank?: () => string;
  };
  // Rows of `choices` that do something first, such as logging in, and then ask
  // again. Their values are never a target, so errors do not list them.
  readonly detours?: Readonly<
    Record<string, Effect.Effect<void, CliFailure, R>>
  >;
  // Where to go when there is nothing to choose from.
  readonly emptyHint?: string;
  // The failure when nothing exists and nothing can be created.
  readonly whenEmpty?: () => CliFailure;
}

const NEW = "\0new";

const capitalize = (text: string) =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const envAllowed = (definition: TargetDefinition, kind: ActionKind) =>
  definition.env !== undefined && kind !== "remove";

const envNote = (definition: TargetDefinition, kind: ActionKind) => {
  if (definition.env === undefined) {
    return "";
  }

  return envAllowed(definition, kind)
    ? `Defaults to ${definition.env}.`
    : `Deletions never use ${definition.env}.`;
};

const describe = (
  definition: TargetDefinition,
  usage: TargetUsage,
  kind: ActionKind
) =>
  [
    `${capitalize(definition.noun)} ${definition.identifiedBy}.`,
    usage.creates ? "Created if it does not exist, reused if it does." : "",
    envNote(definition, kind),
    usage.filter
      ? `Narrows the command to one ${definition.noun}.`
      : "Asked for in a terminal when missing.",
  ]
    .filter(Boolean)
    .join(" ");

const fromEnvironment = (definition: TargetDefinition, kind: ActionKind) => {
  const value = envAllowed(definition, kind)
    ? process.env[definition.env ?? ""]?.trim()
    : undefined;

  return value ? Option.some(value) : Option.none<string>();
};

export const target = (definition: TargetDefinition) => {
  const validate = (value: string) => {
    const problem = definition.check?.(value);

    return problem === undefined
      ? Effect.succeed(value)
      : Effect.fail(fail("USAGE_ERROR", problem));
  };

  const input = (usage: TargetUsage = {}) => {
    const spelled = usage.positional
      ? `<${definition.name}>`
      : `--${definition.name} <${definition.metavar}>`;

    const param: Input<Option.Option<string>> = {
      build: (kind) => {
        const description = describe(definition, usage, kind);

        return {
          info:
            definition.env !== undefined && envAllowed(definition, kind)
              ? { env: definition.env }
              : {},
          name: definition.name,
          param: usage.positional
            ? Argument.String(definition.name).pipe(
                Argument.withDescription(description),
                Argument.optional
              )
            : Flag.String(definition.name).pipe(
                Flag.withMetavar(definition.metavar),
                Flag.withDescription(description),
                Flag.optional
              ),
          positional: usage.positional === true,
        };
      },
    };

    const answered = (value: string) =>
      Effect.as(
        recordAnswer(
          usage.positional
            ? { positional: value }
            : { option: [`--${definition.name}`, value] }
        ),
        value
      );

    const missing = <R>(options: ResolveOptions<R>, kind: ActionKind) =>
      Effect.gen(function* () {
        // Best effort: the failure is about the missing input, not about listing.
        const listed = Option.map(
          yield* Effect.option(options.choices),
          (all) => all.filter((c) => options.detours?.[c.value] === undefined)
        );

        const values = Option.map(listed, (all) => all.map((c) => c.value));

        // What to pass, with the name a person knows it by when that differs.
        const shown = Option.map(listed, (all) =>
          all.map((c) =>
            c.label === c.value ? c.value : `${c.value} (${c.label})`
          )
        );

        const agent = detectAgent();

        return yield* fail(
          "CONTEXT_MISSING",
          `No ${definition.noun} selected.`,
          {
            details: {
              choices: Option.getOrNull(values),
              input: spelled,
            },
            suggestion: [
              `Pass ${spelled}${envAllowed(definition, kind) ? ` or set ${definition.env}` : ""}${usage.creates ? "; a new name creates one" : ""}.`,
              Option.match(shown, {
                onNone: () => "",
                onSome: (all) =>
                  all.length > 0
                    ? `Choose one of: ${all.join(", ")}.`
                    : (options.emptyHint ?? ""),
              }),
              agent === undefined
                ? ""
                : `Questions are off because a coding agent was detected (${agent}).`,
            ]
              .filter(Boolean)
              .join("\n"),
          }
        );
      });

    const askNew = <R>(create: NonNullable<ResolveOptions<R>["create"]>) =>
      Effect.gen(function* () {
        const name = yield* askText({
          initialValue: create.initialValue,
          message: create.prompt,
          validate: (value) =>
            (create.whenBlank === undefined
              ? required(capitalize(definition.noun))(value)
              : undefined) ??
            (value.trim() === ""
              ? undefined
              : definition.check?.(value.trim())),
        });

        return name === "" && create.whenBlank ? create.whenBlank() : name;
      });

    // Nothing exists and nothing can be created here.
    const nothingToChoose = <R>(options: ResolveOptions<R>) =>
      options.whenEmpty?.() ??
      fail(
        "NOT_FOUND",
        `There is no ${definition.noun} to choose from.`,
        options.emptyHint === undefined ? {} : { suggestion: options.emptyHint }
      );

    // Step 3: a person picks one of the existing ones, or names a new one.
    const ask = <R>(
      options: ResolveOptions<R>
    ): Effect.Effect<string, CliFailure, R> =>
      Effect.gen(function* () {
        const choices = yield* options.choices;
        const { create } = options;

        if (choices.length === 0) {
          return create === undefined
            ? yield* nothingToChoose(options)
            : yield* askNew(create);
        }

        const extra =
          create === undefined ? [] : [{ label: create.label, value: NEW }];

        const selected = yield* askSelect({
          choices: [...choices, ...extra],
          message: `Which ${definition.noun}?`,
        });

        return yield* answer(options, selected);
      });

    // What a picked row means: a target, a new name to ask for, or a detour.
    const answer = <R>(
      options: ResolveOptions<R>,
      selected: string
    ): Effect.Effect<string, CliFailure, R> => {
      const detour = options.detours?.[selected];

      if (detour !== undefined) {
        return Effect.andThen(detour, ask(options));
      }

      return selected === NEW && options.create !== undefined
        ? askNew(options.create)
        : Effect.succeed(selected);
    };

    // The target's value, resolved by the rules above.
    const resolve = <R>(
      supplied: Option.Option<string>,
      options: ResolveOptions<R>
    ) =>
      Effect.gen(function* () {
        const { kind } = yield* ActionContext;

        const given = Option.orElse(supplied, () =>
          fromEnvironment(definition, kind)
        );

        if (Option.isSome(given)) {
          return yield* validate(given.value);
        }

        if (!(yield* isInteractive)) {
          return yield* missing(options, kind);
        }

        return yield* answered(yield* ask(options));
      });

    // A target that only narrows what a command shows: the flag or the environment
    // variable, never a question.
    const optional = (supplied: Option.Option<string>) =>
      Effect.gen(function* () {
        const { kind } = yield* ActionContext;

        const given = Option.orElse(supplied, () =>
          fromEnvironment(definition, kind)
        );

        return Option.isSome(given)
          ? Option.some(yield* validate(given.value))
          : Option.none<string>();
      });

    return { ...param, optional, resolve };
  };

  return { definition, input };
};

export type TargetInput = ReturnType<ReturnType<typeof target>["input"]>;
