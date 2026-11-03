import { Effect, Option } from "effect";
import path from "node:path";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { command } from "../../core/invocation.ts";
import type { Store } from "../../core/store.ts";
import type { StoreClient } from "../../core/store-api.ts";
import { resolveStore } from "../../core/stores.ts";
import { type ConfigFile, configFiles } from "../../core/components.ts";
import {
  configPath,
  findProject,
  rememberEnvironment,
} from "../../core/project.ts";
import { storeToken, type StoreTokenOptions } from "../../core/store-token.ts";
import {
  DEFAULT_CONFIG,
  existingConfig,
  shown,
  supportedSaleor,
  validateFile,
} from "./engine.ts";

// The configuration file: --config, else the project's, else ./config.yml.
export const configFile = (input: Option.Option<string>) =>
  Option.match(input, {
    onNone: () =>
      Option.match(findProject(), {
        onNone: () => path.resolve(DEFAULT_CONFIG),
        onSome: configPath,
      }),
    onSome: (file) => path.resolve(file),
  });

// The files a command that compares or deploys works on: --config alone, else every
// file the project deploys (its own, then its components'), else ./config.yml.
export const deployedFiles = (
  input: Option.Option<string>
): readonly ConfigFile[] =>
  Option.match(Option.isSome(input) ? Option.none() : findProject(), {
    onNone: () => [{ component: undefined, file: configFile(input) }],
    onSome: configFiles,
  });

// For commands that cover every file the project deploys: its own and its components'.
export const deployedInput = option.string("config", {
  description:
    "One configuration file. Defaults to every file the project deploys (saleor.yml: its config, then each component's), else ./config.yml.",
  metavar: "path",
});

// The files, each checked to exist and be valid, in the order they deploy.
export const checkedFiles = (input: Option.Option<string>) =>
  Effect.forEach(deployedFiles(input), ({ component, file }) =>
    Effect.gen(function* () {
      const found = yield* existingConfig(file);
      const parsed = yield* validateFile(found);

      return { component, file: found, parsed };
    })
  );

// "config.yml" or "config.yml and storefront/…/content.yml", for sentences.
export const filesShown = (files: readonly { readonly file: string }[]) =>
  files.map(({ file }) => shown(file)).join(" and ");

const checkVersion = (store: Store) =>
  Effect.gen(function* () {
    const supported = yield* supportedSaleor;

    if (
      store.saleorVersion !== null &&
      !store.saleorVersion.startsWith(`${supported}.`)
    ) {
      return yield* fail(
        "UNSUPPORTED_SALEOR_VERSION",
        `${store.ref} runs Saleor ${store.saleorVersion}; this CLI's configuration support is for Saleor ${supported}.`,
        {
          suggestion: `Use the Configurator release for that Saleor version: npx @saleor/configurator@${store.saleorVersion.split(".").slice(0, 2).join(".")}`,
        }
      );
    }
  });

// The store named by `<env>` (or the project's, or a pick), and a token for its API,
// once its Saleor version is one the engine supports.
export const connect = (
  env: Option.Option<string>,
  options?: StoreTokenOptions
) =>
  Effect.gen(function* () {
    const resolved = yield* resolveStore(env);

    yield* checkVersion(resolved.store);

    const { token } = yield* storeToken(resolved, options);

    return { store: resolved.store, token } satisfies StoreClient;
  });

// An environment's name for a store: "local" for the first local one, else its name.
export const environmentName = (store: Store) =>
  store.kind === "local" ? "local" : store.name;

// After a pull or deploy, the project remembers the store it used, so the next run
// needs no ref. Returns a line saying so, when one was added.
export const remember = (file: string, store: Store) =>
  Effect.map(
    rememberEnvironment({
      root: Option.match(findProject(path.dirname(file)), {
        onNone: () => path.dirname(file),
        onSome: (project) => project.root,
      }),
      wanted: environmentName(store),
      ref: store.ref,
    }),
    ({ added, name }) =>
      added
        ? `Remembered ${store.ref} as environment "${name}" in saleor.yml; next time, run: ${command("config", "deploy", name)}`
        : undefined
  );
