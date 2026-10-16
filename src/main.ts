import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { Command } from "effect/cli";
import { catalogCommand } from "./core/catalog.ts";
import { collectCommands } from "./core/module.ts";
import { OutputFlag } from "./core/output.ts";
import { createCliRuntime } from "./core/runtime.ts";
import { cloudLayer, cloudModule } from "./modules/cloud/index.ts";

const VERSION = "2.0.0-poc.0";

const modules = [cloudModule];
const moduleCommands = collectCommands(modules);

export const root = Command.make("saleor").pipe(
  Command.withDescription(
    "Saleor CLI. Output is JSON when piped or run by a coding agent; text in a terminal."
  ),
  Command.withSubcommands([
    ...moduleCommands,
    catalogCommand(() => moduleCommands),
  ]),
  Command.withGlobalFlags([OutputFlag])
);

export const main = createCliRuntime(root, {
  services: Layer.mergeAll(cloudLayer, NodeServices.layer),
  version: VERSION,
});
