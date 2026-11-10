import { Effect } from "effect";
import { command } from "../../core/invocation.ts";
import type { StoreClient } from "../../core/store-api.ts";
import { type Given, target } from "../../core/target.ts";
import type { InstalledApp } from "./store.ts";

// An app installed on a store. Without --app, a person picks it from the store's
// apps, after the store itself is known.
const installedApp = target({
  identifiedBy: "name, id, identifier or manifest URL",
  metavar: "app",
  name: "app",
  noun: "app",
});

export const appInput = installedApp.input();

// The choices for `appInput` on one store: each app by its name, picked by its id.
export const appChoices = (
  client: StoreClient,
  apps: readonly InstalledApp[]
) => ({
  choices: Effect.succeed(
    apps.map((each) => ({
      hint: each.identifier ?? each.id,
      label: each.name ?? each.id,
      value: each.id,
    }))
  ),
  emptyHint: `Install one with: ${command("app", "add", client.store.ref)}`,
});

// The name of an app `app create` starts from the template.
export const newAppInput = target({
  identifiedBy: "name; its folder and manifest id come from it",
  metavar: "name",
  name: "app",
  noun: "app",
}).input({ creates: true });

// How `newAppInput` is resolved: there is nothing to pick, so a person names one.
export const resolveNewApp = (given: Given) =>
  newAppInput.resolve(given, {
    choices: Effect.succeed([]),
    create: {
      label: "Create an app",
      placeholder: "loyalty",
      prompt: "What is the app called?",
    },
  });
