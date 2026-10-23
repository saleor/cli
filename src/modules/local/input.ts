import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import {
  askSelect,
  askText,
  isInteractive,
  required,
} from "../../core/interaction.ts";
import { listInstanceNames, localName } from "./state.ts";

export const resolveLocalName = (
  supplied: Option.Option<string>,
  purpose: "existing" | "setup",
  dryRun = false
) =>
  Effect.gen(function* () {
    if (Option.isSome(supplied)) {
      return yield* localName(supplied.value);
    }

    if (dryRun || !(yield* isInteractive)) {
      return yield* fail("CONTEXT_MISSING", "No local instance selected.", {
        suggestion:
          "Pass --name <name>. Use saleor local list to see saved instances.",
      });
    }

    const names = yield* listInstanceNames();
    const create = "\0new";

    if (names.length > 0) {
      const selected = yield* askSelect({
        choices: [
          ...names.map((name) => ({ label: name, value: name })),
          ...(purpose === "setup"
            ? [{ label: "Create a new instance", value: create }]
            : []),
        ],
        message: "Which local instance?",
      });

      if (selected !== create) {
        return yield* localName(selected);
      }
    } else if (purpose === "existing") {
      return yield* fail("CONTEXT_MISSING", "No local instances found.", {
        suggestion: "Create one with: saleor local up --name <name>",
      });
    }

    return yield* localName(
      yield* askText({
        message: "Local instance name",
        validate: required("An instance name"),
      })
    );
  });
