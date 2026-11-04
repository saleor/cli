import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import { askSelect, isInteractive } from "../../core/interaction.ts";
import { command, recordAnswer } from "../../core/invocation.ts";
import type { StoreClient } from "../../core/store-api.ts";
import type { InstalledApp } from "./store.ts";

// Without --app, a person picks the app from the store's list; anything else has to
// name it. Checked before connecting, so a run that cannot ask fails at once.
export const canAskForApp = (given: Option.Option<string>, verb: string) =>
  Effect.gen(function* () {
    if (Option.isSome(given) || (yield* isInteractive)) {
      return;
    }

    return yield* fail("CONTEXT_MISSING", `Name the app to ${verb}.`, {
      suggestion: `Pass --app <name or id>; see the apps with: ${command("app", "list")}`,
    });
  });

export const pickApp = (
  client: StoreClient,
  apps: readonly InstalledApp[],
  verb: string
) =>
  Effect.gen(function* () {
    if (apps.length === 0) {
      return yield* fail(
        "NOT_FOUND",
        `There are no apps to ${verb} on ${client.store.ref}.`,
        {
          suggestion: `Install one with: ${command("app", "add", client.store.ref)}`,
        }
      );
    }

    const id = yield* askSelect({
      choices: apps.map((each) => ({
        hint: each.identifier ?? each.id,
        label: each.name ?? each.id,
        value: each.id,
      })),
      message: `Which app do you want to ${verb}?`,
    });

    yield* recordAnswer({ option: ["--app", id] });

    return id;
  });
