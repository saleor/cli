import { NodeServices } from "@effect/platform-node";
import { type Effect, Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { GLOBAL_INPUTS } from "./core/globals.ts";
import { InstanceSources } from "./core/instance.ts";
import { NoInputFlag } from "./core/interaction.ts";
import { collectCommands } from "./core/module.ts";
import { AgentFlag, OutputFlag } from "./core/output.ts";
import { builtIns, createCliRuntime } from "./core/runtime.ts";
import { setupCommand } from "./core/setup.ts";
import { cloudModule } from "./modules/cloud/index.ts";
import { localModule } from "./modules/local/index.ts";
import { storefrontModule } from "./modules/storefront/index.ts";

const modules = [cloudModule, localModule, storefrontModule];

// `init` comes first: getting a store is what most people come for.
const moduleCommands = [
  setupCommand(
    modules.flatMap((module) => module.setup ?? []),
    modules.flatMap((module) => module.setupExtension ?? [])
  ),
  ...collectCommands(modules),
];

export const root = Command.make("saleor").pipe(
  Command.withDescription(
    "Set up and manage Saleor stores in Cloud or locally with Docker, and storefronts connected to them."
  ),
  Command.withSubcommands([
    ...moduleCommands,
    catalogCommand(
      () => moduleCommands,
      [...builtIns.map((global) => ({ global, info: {} })), ...GLOBAL_INPUTS]
    ),
  ]),
  Command.withGlobalFlags([OutputFlag, NoInputFlag, AgentFlag])
);

const runCli = createCliRuntime(root, {
  services: Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(
      InstanceSources,
      modules.flatMap((module) => module.instances ?? [])
    ),
    ...modules.map((module) => module.layer)
  ),
  version: packageJson.version,
});

export const main = (argv: readonly string[]): Effect.Effect<void> =>
  runCli(argv);
