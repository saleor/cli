import { Context, Effect, Option } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { lastDeploy } from "./deploy-record.ts";
import type { CliFailure } from "./errors.ts";
import type { StoreClient } from "./store-api.ts";

// The project's store configuration (config.yml), as core needs it: checked before a
// store is made, and applied to a new one. The config module provides it.
export class ProjectConfiguration extends Context.Service<
  ProjectConfiguration,
  {
    // Deploys the file to the store, and records the deploy.
    readonly apply: (
      client: StoreClient,
      file: string
    ) => Effect.Effect<void, CliFailure>;
    readonly validate: (file: string) => Effect.Effect<void, CliFailure>;
  }
>()("saleor/ProjectConfiguration") {}

// Whether the file asks for anything: a new project's config.yml is `{}`.
export const hasConfiguration = (file: string) =>
  existsSync(file) && !["", "{}"].includes(readFileSync(file, "utf-8").trim());

// Whether a store still needs the project's configuration: there is some, and the
// store was just created or has never had it deployed from this computer. This is
// the one rule for giving a new store what the project describes (`env add`,
// `env start` of a local definition, `init` in a project).
export const configurationPending = (
  file: string,
  ref: string,
  created: boolean
) =>
  hasConfiguration(file) && (created || Option.isNone(lastDeploy(file, ref)));

export const validateConfiguration = (file: string) =>
  Effect.gen(function* () {
    yield* (yield* ProjectConfiguration).validate(file);
  });

export const applyConfiguration = (client: StoreClient, file: string) =>
  Effect.gen(function* () {
    yield* (yield* ProjectConfiguration).apply(client, file);
  });
