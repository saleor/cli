import type { Effect, Layer } from "effect";
import type { Command, GlobalFlag } from "effect/cli";
import type { StoreSource, StoreSources } from "./store.ts";
import type { SetupExtension, SetupProvider } from "./setup.ts";
import type { ProjectConfiguration } from "./project-configuration.ts";

// A module is a unit of code ownership (Cloud, local, storefront; Configurator later).
// It owns one or more top-level command words, and the layer that builds the services
// those commands run with. The words are what users and agents type; the module is how
// the code is organised. A module that can run a store also contributes a setup
// provider to `saleor init` and a source of its stores; a module that builds on a
// store can extend `init` with more to set up.
export interface CliModule {
  readonly commands: readonly Command.Command.Any[];
  readonly description: string;
  // Core services this module implements, such as the project's configuration.
  readonly provides: Layer.Layer<ProvidedServices> | undefined;
  // A line shown above the home menu, such as the account or project in use.
  readonly status: Effect.Effect<string | undefined> | undefined;
  readonly stores: StoreSource<never> | undefined;
  // Erased here; `defineModule` checked it against the commands' requirements.
  readonly layer: Layer.Layer<never>;
  readonly name: string;
  readonly setup: SetupProvider<never> | undefined;
  readonly setupExtension: SetupExtension<never> | undefined;
}

// Core services one module implements for the others (`provides`).
export type ProvidedServices = ProjectConfiguration;

// Services the root command provides to every module: its global flags, the stores
// every module contributes, and what modules provide.
export type CoreServices =
  | GlobalFlag.Setting.Identifier<"output">
  | StoreSources
  | ProvidedServices;

// Any command, keeping only what it requires to run.
// oxlint-disable-next-line typescript/no-explicit-any -- Command names are invariant; a module holds commands of any name.
type ModuleCommand<R> = Command.Command<any, never, unknown, unknown, R>;

// Ties a module's commands to its layer at compile time: if a command needs a service
// the layer does not build, this does not type-check. Registration itself erases the
// types (Effect's subcommand list is `Command.Any`), so this is where they are checked.
export const defineModule = <R>(module: {
  readonly commands: readonly ModuleCommand<R>[];
  readonly description: string;
  readonly provides?: Layer.Layer<ProvidedServices>;
  readonly status?: Effect.Effect<string | undefined>;
  readonly stores?: StoreSource<R>;
  readonly layer: Layer.Layer<NoInfer<Exclude<R, CoreServices>>>;
  readonly name: string;
  readonly setup?: SetupProvider<R>;
  readonly setupExtension?: SetupExtension<R>;
}): CliModule => ({
  ...module,
  provides: module.provides,
  status: module.status,
  // Like the commands, these contributions' requirements were checked against the
  // layer above, and the composition root provides every module's layer.
  // SAFETY: requirements checked against the module's layer, as described above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- defineModule checks requirements against its layer before erasing them for registration.
  stores: module.stores as StoreSource<never> | undefined,
  // SAFETY: requirements checked against the module's layer, as described above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- defineModule checks requirements against its layer before erasing them for registration.
  setup: module.setup as SetupProvider<never> | undefined,
  // SAFETY: requirements checked against the module's layer, as described above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- defineModule checks requirements against its layer before erasing them for registration.
  setupExtension: module.setupExtension as SetupExtension<never> | undefined,
});

// Commands that belong to the CLI itself rather than to any module.
export const RESERVED_WORDS = [
  "commands",
  "env",
  "onboard",
  "init",
  "help",
  "version",
  "completions",
] as const;

export const collectCommands = (modules: readonly CliModule[]) => {
  const owners = new Map<string, string>(
    RESERVED_WORDS.map((word) => [word, "core"])
  );

  const commands = modules.flatMap((module) => module.commands);

  for (const module of modules) {
    const words = module.commands
      .flatMap((command) => [command.name, command.alias])
      .filter((word): word is string => word !== undefined);

    for (const word of words) {
      const owner = owners.get(word);

      if (owner !== undefined) {
        throw new Error(
          `Top-level command "${word}" is claimed by both "${owner}" and "${module.name}"`
        );
      }

      owners.set(word, module.name);
    }
  }

  return commands;
};
