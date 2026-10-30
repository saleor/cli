import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { existsSync } from "node:fs";
import { MenuAvailable } from "../../core/menu.ts";
import { defineModule } from "../../core/module.ts";
import { findProject } from "../../core/project.ts";
import { SecretStoreLive } from "../../core/secret-store.ts";
import { configCommand } from "./commands.ts";
import { DEFAULT_CONFIG } from "./engine.ts";
import { configSetup } from "./setup.ts";

// `configurator` is an alias, so the word people know from the standalone tool works.
// The menu offers it inside a project or beside a configuration file; typed, it
// always works. `init` asks what a new store should contain.
export const configModule = defineModule({
  commands: [
    configCommand.pipe(
      Command.withAlias("configurator"),
      Command.annotate(
        MenuAvailable,
        Effect.sync(
          () => Option.isSome(findProject()) || existsSync(DEFAULT_CONFIG)
        )
      )
    ),
  ],
  description:
    "Store configuration as code (Saleor Configurator), for any store the CLI can reach.",
  layer: SecretStoreLive,
  name: "config",
  setupExtension: configSetup,
});
