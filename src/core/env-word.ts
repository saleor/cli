import { Effect, Option } from "effect";
import path from "node:path";
import { fail } from "./errors.ts";
import { askSelect, isInteractive } from "./interaction.ts";
import { ActionContext, command, recordAnswer } from "./invocation.ts";
import { findProject, type Project } from "./project.ts";
import { kindOf, REF } from "./ref.ts";

// Every command that acts on a store names it with one word, `<env>`: an environment
// named in the project's saleor.yml, or a ref (`local:<name>`, `cloud:<org>/<env key>`)
// for any store, inside a project or not. This file turns that word into a ref.

export const ENV_VARIABLE = "SALEOR_ENV";

const environmentsOf = (project: Option.Option<Project>) =>
  Option.match(project, {
    onNone: () => [],
    onSome: (found) => found.environments,
  });

// The word a person would type for this store here: its name in saleor.yml, else its
// ref. Hints use it, so a suggested command reads like the ones people type.
export const envWord = (ref: string) =>
  environmentsOf(findProject()).find(([, each]) => each === ref)?.[0] ?? ref;

const unknownEnvironment = (name: string, project: Option.Option<Project>) =>
  Option.match(project, {
    onNone: () =>
      fail(
        "NOT_FOUND",
        `"${name}" is not a store ref, and there is no saleor.yml here to name it.`,
        {
          suggestion: `Pass a ref (local:<name>, cloud:<org>/<env key>), as printed by: ${command("env", "list")}`,
        }
      ),
    onSome: (found) =>
      fail(
        "NOT_FOUND",
        `No environment "${name}" in ${path.join(found.root, "saleor.yml")}.`,
        {
          suggestion: [
            found.environments.length > 0
              ? `Known environments: ${found.environments.map(([each]) => each).join(", ")}.`
              : "",
            `Add one with: ${command("env", "add", name)}`,
          ]
            .filter(Boolean)
            .join(" "),
        }
      ),
  });

// A word as a ref: refs as they are, names through saleor.yml.
export const toRef = (word: string) =>
  Effect.gen(function* () {
    if (REF.test(word)) {
      return word;
    }

    const project = findProject();
    const found = environmentsOf(project).find(([name]) => name === word);

    return found === undefined
      ? yield* unknownEnvironment(word, project)
      : found[1];
  });

// Which store a command acts on, in order: the `<env>` word; SALEOR_ENV; the project's
// only environment; a pick among the project's environments. None when there is no
// project to choose from, and the caller offers every store. Removals (stop, remove)
// act only on what the command line or a person named: they never read SALEOR_ENV
// and never take the only environment for granted. `kinds` leaves out environments
// whose stores cannot do what the command does (Cloud stores cannot be stopped).
export const resolveRef = (
  supplied: Option.Option<string>,
  { kinds }: { readonly kinds?: readonly string[] } = {}
) =>
  Effect.gen(function* () {
    const removal = (yield* ActionContext).kind === "remove";
    const project = findProject();

    const fromEnv = removal ? undefined : process.env[ENV_VARIABLE]?.trim();

    const explicit = Option.orElse(supplied, () =>
      Option.filter(Option.fromUndefinedOr(fromEnv), (value) => value !== "")
    );

    if (Option.isSome(explicit)) {
      return Option.some(yield* toRef(explicit.value));
    }

    const environments = environmentsOf(project).filter(
      ([, ref]) => kinds === undefined || kinds.includes(kindOf(ref))
    );

    const [only] = environments;

    if (!removal && environments.length === 1 && only !== undefined) {
      return Option.some(only[1]);
    }

    if (environments.length > 0 && (yield* isInteractive)) {
      const name = yield* askSelect({
        choices: environments.map(([each, ref]) => ({
          hint: ref,
          label: each,
          value: each,
        })),
        message: "Which environment?",
      });

      yield* recordAnswer({ positional: name });

      return Option.some(
        environments.find(([each]) => each === name)?.[1] ?? name
      );
    }

    if (environments.length > 1 || (removal && environments.length > 0)) {
      return yield* fail(
        "CONTEXT_MISSING",
        removal
          ? "Name the environment to act on."
          : "This project has more than one environment; name the one to use.",
        {
          details: {
            choices: environments.map(([each]) => each),
            input: "<env>",
          },
          suggestion: `Pass one of: ${environments.map(([each]) => each).join(", ")}, as the word after the command.`,
        }
      );
    }

    return Option.none<string>();
  });
