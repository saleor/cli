import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { environmentCommand } from "./core/environments.ts";
import { GLOBAL_INPUTS } from "./core/globals.ts";
import { StoreSources } from "./core/store.ts";
import { NoInputFlag } from "./core/interaction.ts";
import { HideFromMenu, MenuStatus } from "./core/menu.ts";
import { collectCommands } from "./core/module.ts";
import { onboard, onboardCommand } from "./core/onboarding.ts";
import { AgentFlag, OutputFlag } from "./core/output.ts";
import { builtIns, createCliRuntime } from "./core/runtime.ts";
import { setupCommand } from "./core/setup.ts";
import { apiModule } from "./modules/api/index.ts";
import { appModule } from "./modules/app/index.ts";
import { cloudAccount, cloudModule } from "./modules/cloud/index.ts";
import { projectStatus } from "./modules/config/commands.ts";
import { configModule } from "./modules/config/index.ts";
import { projectConfigurationLive } from "./modules/config/project-configuration.ts";
import { localModule } from "./modules/local/index.ts";
import { storefrontModule } from "./modules/storefront/index.ts";
import { webhookModule } from "./modules/webhook/index.ts";

// Configuration runs before the storefront during setup, so it sets the channel.
const modules = [
  configModule,
  storefrontModule,
  apiModule,
  appModule,
  webhookModule,
  cloudModule,
  localModule,
];

const providers = modules.flatMap((module) => module.setup ?? []);

// The grammar is `saleor <noun> <verb> [<env>]`. `init` comes first: getting a store
// is what most people come for. `env` is core, like `init`: every module that runs
// stores is an adapter behind it, not a command group of its own.
const moduleCommands = [
  setupCommand(
    providers,
    modules.flatMap((module) => module.setupExtension ?? [])
  ),
  environmentCommand(providers),
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
    projectConfigurationLive,
    NodeServices.layer,
    Layer.succeed(
      StoreSources,
      modules.flatMap((module) => module.stores ?? [])
    ),
    ...modules.map((module) => module.layer)
  ),
  version: packageJson.version,
});

export const main = (argv: readonly string[]): Effect.Effect<void> =>
  runCli(argv);
