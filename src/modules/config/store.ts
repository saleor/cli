import path from "node:path";
import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import type { Instance } from "../../core/instance.ts";
import { InstanceSources } from "../../core/instance.ts";
import { resolveInstance } from "../../core/instances.ts";
import {
  configPath,
  findProject,
  rememberEnvironment,
} from "../../core/project.ts";
import { storeAccess } from "../../core/store-access.ts";
import { resolveRef } from "../../core/workspace.ts";
import { DEFAULT_CONFIG, supportedSaleor } from "./engine.ts";

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

const checkVersion = (instance: Instance) =>
  Effect.gen(function* () {
    const supported = yield* supportedSaleor;

    if (
      instance.saleorVersion !== null &&
      !instance.saleorVersion.startsWith(`${supported}.`)
    ) {
      return yield* fail(
        "UNSUPPORTED_SALEOR_VERSION",
        `${instance.ref} runs Saleor ${instance.saleorVersion}; this CLI's configuration support is for Saleor ${supported}.`,
        {
          suggestion: `Use the Configurator release for that Saleor version: npx @saleor/configurator@${instance.saleorVersion.split(".").slice(0, 2).join(".")}`,
        }
      );
    }
  });

// The store, a token for its API, and the project environment it is known by.
export const connect = (
  environment: Option.Option<string>,
  instance: Option.Option<string>
) =>
  Effect.gen(function* () {
    const ref = yield* resolveRef(environment, instance);
    const resolved = yield* resolveInstance(ref);

    yield* checkVersion(resolved.instance);

    const access = yield* storeAccess(resolved);

    return {
      instance: resolved.instance,
      store: { token: access.token, url: resolved.instance.graphqlUrl },
    };
  });

// The same for a store `init` just made, which needs no resolving.
export const connectMade = (made: Instance) =>
  Effect.gen(function* () {
    const sources = yield* InstanceSources;
    const source = sources.find((each) => each.kind === made.kind);

    if (source === undefined) {
      return yield* fail("NOT_FOUND", `No source for ${made.ref}.`);
    }

    const access = yield* storeAccess({ instance: made, source });

    return { token: access.token, url: made.graphqlUrl };
  });

// An environment's name for a store: "local" for the first local one, else its name.
export const environmentName = (instance: Instance) =>
  instance.kind === "local" ? "local" : instance.name;

// After a pull or deploy, the project remembers the store it used, so the next run
// needs no ref. Returns a line saying so, when one was added.
export const remember = (file: string, instance: Instance) =>
  Effect.map(
    rememberEnvironment(
      Option.match(findProject(path.dirname(file)), {
        onNone: () => path.dirname(file),
        onSome: (project) => project.root,
      }),
      environmentName(instance),
      instance.ref
    ),
    ({ added, name }) =>
      added
        ? `Remembered ${instance.ref} as environment "${name}" in saleor.yml; next time, run: saleor config deploy ${name}`
        : undefined
  );
