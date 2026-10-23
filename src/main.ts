import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { NoInputFlag } from "./core/interaction.ts";
import { collectCommands } from "./core/module.ts";
import { ContinueInCli, navigation } from "./core/navigation.ts";
import { AgentFlag, OutputFlag } from "./core/output.ts";
import { builtIns, createCliRuntime } from "./core/runtime.ts";
import { cloudModule } from "./modules/cloud/index.ts";
import { localModule } from "./modules/local/index.ts";
import { workspaceCommands } from "./workspace.ts";

const modules = [cloudModule, localModule];

const moduleCommands = [...collectCommands(modules), ...workspaceCommands()];

export const root = Command.make("saleor").pipe(
  Command.withDescription(
    "Set up and manage Saleor stores in Cloud or locally with Docker."
  ),
  Command.withSubcommands([
    ...moduleCommands,
    catalogCommand(
      () => moduleCommands,
      [...builtIns, OutputFlag, NoInputFlag, AgentFlag]
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
  runCli(argv).pipe(Effect.provideService(ContinueInCli, navigation(runCli)));
