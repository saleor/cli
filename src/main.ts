import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { GLOBAL_INPUTS } from "./core/globals.ts";
import { InstanceSources } from "./core/instance.ts";
import { NoInputFlag } from "./core/interaction.ts";
import { HideFromMenu, MenuAvailable, MenuStatus } from "./core/menu.ts";
import { collectCommands } from "./core/module.ts";
import { onboard, onboardCommand } from "./core/onboarding.ts";
import { AgentFlag, OutputFlag } from "./core/output.ts";
import { builtIns, createCliRuntime } from "./core/runtime.ts";
import { setupCommand } from "./core/setup.ts";
import {
  cloudAccount,
  cloudModule,
  cloudSignedIn,
} from "./modules/cloud/index.ts";
import { projectStatus } from "./modules/config/commands.ts";
import { configModule } from "./modules/config/index.ts";
import { workspaceConfigurationLive } from "./modules/config/workspace.ts";
import { hasLocalInstances, localModule } from "./modules/local/index.ts";
import { storefrontModule } from "./modules/storefront/index.ts";

// People mostly work in Cloud or locally, not both. Once logged in to Cloud, the menu
// leaves out local commands unless there are local instances to manage. Typed commands
// always work.
const offerLocal = Effect.map(
  Effect.all([cloudSignedIn, hasLocalInstances]),
  ([cloud, local]) => !cloud || local
);

const modules = [
  // Put day-to-day configuration and storefront work before environment management.
  // Configuration also runs before the storefront during setup, so it sets the channel.
  configModule,
  storefrontModule,
  cloudModule,
  {
    ...localModule,
    commands: localModule.commands.map((command) =>
      command.pipe(Command.annotate(MenuAvailable, offerLocal))
    ),
  },
];

// `init` comes first: getting a store is what most people come for.
const moduleCommands = [
  setupCommand(
    modules.flatMap((module) => module.setup ?? []),
    modules.flatMap((module) => module.setupExtension ?? [])
  ),
  ...collectCommands(modules),
  onboardCommand.pipe(Command.annotate(HideFromMenu, true)),
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
  Command.withGlobalFlags([OutputFlag, NoInputFlag, AgentFlag]),
  Command.annotate(
    MenuStatus,
    Effect.map(Effect.all([projectStatus, cloudAccount]), (lines) => {
      const shown = lines.filter((line) => line !== undefined);

      return shown.length > 0 ? shown.join("\n") : undefined;
    })
  )
);

const runCli = createCliRuntime(root, {
  onboard,
  services: Layer.mergeAll(
    workspaceConfigurationLive,
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
