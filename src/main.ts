import { NodeServices } from "@effect/platform-node";
import { Layer } from "effect";
import { Command } from "effect/cli";
import packageJson from "../package.json" with { type: "json" };
import { catalogCommand } from "./core/catalog.ts";
import { collectCommands } from "./core/module.ts";
import { OutputFlag } from "./core/output.ts";
import { createCliRuntime } from "./core/runtime.ts";
import { cloudModule } from "./modules/cloud/index.ts";

const modules = [cloudModule];
const moduleCommands = collectCommands(modules);

export const root = Command.make("saleor").pipe(
  Command.withDescription(
    "Manage Saleor Cloud projects and sandbox environments from your terminal."
  ),
  Command.withSubcommands([
    ...moduleCommands,
    catalogCommand(() => moduleCommands),
  ]),
  Command.withGlobalFlags([OutputFlag])
);

export const main = createCliRuntime(root, {
  services: Layer.mergeAll(
    NodeServices.layer,
    ...modules.map((module) => module.layer)
  ),
  version: packageJson.version,
});
