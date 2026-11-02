import { Effect, Option } from "effect";
import { type CliFailure, fail } from "./errors.ts";
import {
  type Instance,
  type InstanceSource,
  InstanceSources,
  type Lifecycle,
} from "./instance.ts";
import { askConfirm, type Choice, isInteractive } from "./interaction.ts";
import { command } from "./invocation.ts";
import { notice } from "./output.ts";
import { findProject } from "./project.ts";
import { target } from "./target.ts";
import {
  ENV_VARIABLE,
  envWord,
  kindOf,
  REF,
  resolveRef,
  toRef,
} from "./workspace.ts";

// Every command that acts on a store takes it as `<env>`: a name from saleor.yml or a
// ref, `cloud:<org>/<env key>` or `local:<name>`, the same `ref` every command prints.
// In a terminal, a person picks from the project's environments, else from the stores
// of every source; one that needs a login is offered as "Log in to …" instead of
// failing the whole list.

const SIGN_IN = "\0sign-in:";

export const envTarget = target({
  check: (value) =>
    REF.test(value) ||
    Option.exists(findProject(), (project) =>
      project.environments.some(([name]) => name === value)
    )
      ? undefined
      : `"${value}" is neither an environment in saleor.yml nor a store ref. Refs look like cloud:<org>/<env key> or local:<name>, as printed in the REF column of ${command("env", "list")}.`,
  env: ENV_VARIABLE,
  identifiedBy:
    "name in saleor.yml, or a store ref: cloud:<org>/<env key> or local:<name>",
  metavar: "env",
  name: "env",
  noun: "environment",
});

export const envInput = envTarget.input({ positional: true });

const VERBS: Record<Lifecycle, string> = {
  remove: "deleted",
  start: "started",
  stop: "stopped",
};

// Runs `effect` against a source; when it needs a login and a person is at a
// terminal, offers one and runs it again.
export const withSignIn = <A, R>(
  source: InstanceSource<never>,
  effect: Effect.Effect<A, CliFailure, R>
) =>
  effect.pipe(
    Effect.catchTag("CliFailure", (failure: CliFailure) =>
      Effect.gen(function* () {
        const { signIn } = source;

        if (
          failure.code !== "AUTH_REQUIRED" ||
          signIn === undefined ||
          !(yield* isInteractive)
        ) {
          return yield* failure;
        }

        yield* notice(`You are not logged in to ${source.label}.`);

        if (!(yield* askConfirm("Log in now in your browser?"))) {
          return yield* failure;
        }

        yield* signIn;

        return yield* effect;
      })
    )
  );

const choicesOf = (source: InstanceSource<never>) =>
  source.list.pipe(
    Effect.map((instances) =>
      instances.map((found): Choice<string> => ({
        hint: `${found.ref} · ${found.state}`,
        label: `${source.label} · ${found.name}`,
        value: found.ref,
      }))
    ),
    Effect.catchTag("CliFailure", (failure: CliFailure) => {
      if (failure.code === "AUTH_REQUIRED" && source.signIn !== undefined) {
        return Effect.succeed([
          {
            label: `Log in to ${source.label} to see its stores`,
            value: `${SIGN_IN}${source.kind}`,
          },
        ]);
      }

      // One source failing (Cloud unreachable) still leaves the others to pick from.
      return Effect.as(
        notice(`Could not list ${source.label} stores: ${failure.message}`),
        []
      );
    })
  );

export interface ResolvedRef {
  // The part of the ref after `<kind>:`, which the source knows it by.
  readonly id: string;
  readonly ref: string;
  readonly source: InstanceSource<never>;
}

export interface ResolvedInstance {
  readonly instance: Instance;
  readonly source: InstanceSource<never>;
}

export interface ResolveOptions {
  // Skips the project's environments, for questions about some other store (which
  // one to copy from), so every store is offered.
  readonly anyStore?: boolean;
  // Only stores whose source can do this; the others are refused with a usage error.
  readonly can?: Lifecycle;
}

// The store a command was given, or picked at a prompt, as a ref and the source that
// runs it. Does not look the store up, so it can name one that does not exist yet
// (an environment saleor.yml defines, which `env start` creates).
export const resolveStore = (
  supplied: Option.Option<string>,
  { anyStore = false, can }: ResolveOptions = {}
) =>
  Effect.gen(function* () {
    const all = yield* InstanceSources;

    const sources =
      can === undefined ? all : all.filter((each) => each[can] !== undefined);

    const contextual = anyStore
      ? supplied
      : yield* resolveRef(supplied, {
          kinds: sources.map((each) => each.kind),
        });

    const word = yield* envInput.resolve(contextual, {
      // Stores first; logins after them, so the first row is something to pick.
      choices: Effect.map(Effect.forEach(sources, choicesOf), (lists) => {
        const rows = lists.flat();

        return [
          ...rows.filter((row) => !row.value.startsWith(SIGN_IN)),
          ...rows.filter((row) => row.value.startsWith(SIGN_IN)),
        ];
      }),
      detours: Object.fromEntries(
        sources.flatMap((each) =>
          each.signIn === undefined
            ? []
            : [[`${SIGN_IN}${each.kind}`, each.signIn]]
        )
      ),
      emptyHint: `Create one with: ${command("init")}`,
    });

    const ref = yield* toRef(word);
    const kind = kindOf(ref);
    const source = all.find((candidate) => candidate.kind === kind);

    if (source === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `"${ref}" is not a store ref: stores are ${all.map((s) => `${s.kind}:…`).join(" or ")}.`
      );
    }

    if (can !== undefined && source[can] === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `${source.label} stores cannot be ${VERBS[can]} with the CLI.`,
        sources.length > 0
          ? {
              suggestion: `Only ${sources.map((each) => each.label).join(" and ")} stores can be.`,
            }
          : {}
      );
    }

    return {
      id: ref.slice(kind.length + 1),
      ref,
      source,
    } satisfies ResolvedRef;
  });

// The store a command was given, or picked at a prompt, with the source it came from.
export const resolveInstance = (
  supplied: Option.Option<string>,
  options: ResolveOptions = {}
) =>
  Effect.gen(function* () {
    const { id, ref, source } = yield* resolveStore(supplied, options);
    const found = yield* withSignIn(source, source.find(id));

    if (Option.isNone(found)) {
      return yield* fail(
        "NOT_FOUND",
        `Store "${envWord(ref)}" does not exist.`,
        {
          suggestion: `See every store with: ${command("env", "list")}`,
        }
      );
    }

    return { instance: found.value, source } satisfies ResolvedInstance;
  });
