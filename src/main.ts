import { NodeServices } from "@effect/platform-node";
import { type Effect, Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { GLOBAL_INPUTS } from "./core/globals.ts";
import { NoInputFlag } from "./core/interaction.ts";
import { collectCommands } from "./core/module.ts";
import { AgentFlag, OutputFlag } from "./core/output.ts";
import { builtIns, createCliRuntime } from "./core/runtime.ts";
import { setupCommand } from "./core/setup.ts";
import { cloudModule } from "./modules/cloud/index.ts";
import { localModule } from "./modules/local/index.ts";

const modules = [cloudModule, localModule];

// `init` comes first: getting a store is what most people come for.
const moduleCommands = [
  setupCommand(modules.flatMap((module) => module.setup ?? [])),
  ...collectCommands(modules),
];

export const root = Command.make("saleor").pipe(
  Command.withDescription(
    "Set up and manage Saleor stores in Cloud or locally with Docker."
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
    ...modules.map((module) => module.layer)
  ),
  version: packageJson.version,
});

export const main = (argv: readonly string[]): Effect.Effect<void> =>
  runCli(argv);
