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

// The name of an app of your own, started from the template: required by `app
// create`, offered by `init`.
const newApp = target({
  identifiedBy: "name; its folder and manifest id come from it",
  metavar: "name",
  name: "app",
  noun: "app",
});

export const newAppInput = newApp.input({ creates: true });

export const optionalNewAppInput = newApp.input({
  creates: true,
  optional: true,
});

// How a new app's name is resolved: there is nothing to pick, so a person names one.
export const resolveNewApp = (input: typeof newAppInput, given: Given) =>
  input.resolve(given, {
    choices: Effect.succeed([]),
    create: {
      label: "Create an app",
      placeholder: "loyalty",
      prompt: "What is the app called?",
    },
  });
