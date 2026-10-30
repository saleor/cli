import { Effect, Option } from "effect";
import path from "node:path";
import { fail } from "./errors.ts";
import { askSelect, isInteractive } from "./interaction.ts";
import { findProject, type Project } from "./project.ts";

const REF = /^[a-z]+:.+$/;

const unknownEnvironment = (name: string, project: Option.Option<Project>) =>
  Option.match(project, {
    onNone: () =>
      fail(
        "NOT_FOUND",
        `"${name}" is not a store ref, and there is no saleor.yml here to name it.`,
        {
          suggestion:
            "Pass a ref (local:<name>, cloud:<org>/<env key>) with --instance; a pull or deploy then remembers it in saleor.yml.",
        }
      ),
    onSome: (found) =>
      fail(
        "NOT_FOUND",
        `No environment "${name}" in ${path.join(found.root, "saleor.yml")}.`,
        {
          suggestion:
            found.environments.length > 0
              ? `Known environments: ${found.environments.map(([each]) => each).join(", ")}. Add one by running a pull or deploy with --instance <ref>.`
              : "Add one by running a pull or deploy with --instance <ref>.",
        }
      ),
  });

// Which store a command acts on: an environment named in saleor.yml (or a ref) as the
// first word, --instance, the project's only environment, a pick among the project's
// environments, or the usual store prompt.
export const resolveRef = (
  environment: Option.Option<string>,
  instance: Option.Option<string>
) =>
  Effect.gen(function* () {
    const project = findProject();

    const environments = Option.match(project, {
      onNone: () => [],
      onSome: (found) => found.environments,
    });

    const explicit = Option.orElse(environment, () =>
      Option.orElse(instance, () =>
        Option.fromUndefinedOr(process.env.SALEOR_INSTANCE)
      )
    );

    if (Option.isSome(explicit)) {
      const { value } = explicit;

      if (REF.test(value)) {
        return explicit;
      }

      const found = environments.find(([name]) => name === value);

      return found === undefined
        ? yield* unknownEnvironment(value, project)
        : Option.some(found[1]);
    }

    const [only] = environments;

    if (environments.length === 1 && only !== undefined) {
      return Option.some(only[1]);
    }

    if (environments.length > 1 && (yield* isInteractive)) {
      return Option.some(
        yield* askSelect({
          choices: environments.map(([name, ref]) => ({
            hint: ref,
            label: name,
            value: ref,
          })),
          message: "Which environment?",
        })
      );
    }

    if (environments.length > 1) {
      return yield* fail(
        "CONTEXT_MISSING",
        "This project has more than one environment; name the one to use.",
        {
          details: { choices: environments.map(([name]) => name) },
          suggestion: `Pass one of: ${environments.map(([name]) => name).join(", ")}, as the first word after the command.`,
        }
      );
    }

    return Option.none<string>();
  });
