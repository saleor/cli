import { Effect, Option } from "effect";
import { type CliFailure, fail } from "./errors.ts";
import {
  type Instance,
  type InstanceSource,
  InstanceSources,
} from "./instance.ts";
import type { Choice } from "./interaction.ts";
import { command } from "./invocation.ts";
import { notice } from "./output.ts";
import { findProject } from "./project.ts";
import { target } from "./target.ts";
import { resolveRef } from "./workspace.ts";

// Commands that work with a store wherever it runs (a storefront connecting to one)
// take it as a ref, `cloud:<org>/<env key>` or `local:<name>`: the same `ref` every
// command prints. In a terminal, a person picks from the stores of every source; one
// that needs a login is offered as "Log in to …" instead of failing the whole list.

const REF = /^[a-z]+:.+$/;
const SIGN_IN = "\0sign-in:";

export const instanceTarget = target({
  check: (value) =>
    REF.test(value) ||
    Option.exists(findProject(), (project) =>
      project.environments.some(([name]) => name === value)
    )
      ? undefined
      : `"${value}" is not a store ref. Refs look like cloud:<org>/<env key> or local:<name>, as printed in the ref column of env list and local list.`,
  env: "SALEOR_INSTANCE",
  identifiedBy: "ref: cloud:<org>/<env key> or local:<name>",
  metavar: "ref",
  name: "instance",
  noun: "store",
});

export const instanceInput = instanceTarget.input();

const choicesOf = (source: InstanceSource<never>) =>
  source.list.pipe(
    Effect.map((instances) =>
      instances.map(
        (found): Choice<string> => ({
          hint: `${found.ref} · ${found.state}`,
          label: `${source.label} · ${found.name}`,
          value: found.ref,
        })
      )
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

export interface ResolvedInstance {
  readonly instance: Instance;
  readonly source: InstanceSource<never>;
}

// The store a command was given, or picked at a prompt, with the source it came from.
export const resolveInstance = (supplied: Option.Option<string>) =>
  Effect.gen(function* () {
    const sources = yield* InstanceSources;

    const contextual = yield* resolveRef(Option.none(), supplied);

    const ref = yield* instanceInput.resolve(contextual, {
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

    const separator = ref.indexOf(":");
    const kind = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    const source = sources.find((candidate) => candidate.kind === kind);

    if (source === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `"${ref}" is not a store ref: stores are ${sources.map((s) => `${s.kind}:…`).join(" or ")}.`
      );
    }

    const found = yield* source.find(id);

    if (Option.isNone(found)) {
      return yield* fail("NOT_FOUND", `Store "${ref}" does not exist.`, {
        suggestion: `See the ${source.label} stores with: ${source.listCommand}`,
      });
    }

    return { instance: found.value, source } satisfies ResolvedInstance;
  });
