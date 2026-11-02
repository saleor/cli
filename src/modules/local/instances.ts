import { Effect, Option } from "effect";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  absent,
  DEFAULT_WAIT_SECONDS,
  type Ensured,
  type Planned,
} from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import type {
  Instance,
  InstanceSource,
  StartOptions,
  Started,
} from "../../core/instance.ts";
import { command } from "../../core/invocation.ts";
import { lastInSync } from "../../core/deployments.ts";
import { configuresOnCreate } from "../../core/manifest.ts";
import {
  configPath,
  hasBinding,
  projectLocalOf,
  saveBinding,
} from "../../core/project.ts";
import { WorkspaceConfiguration } from "../../core/workspace-configuration.ts";
import { localAccess } from "./access.ts";
import { down, list, localTarget, planDown, planUp, up } from "./lifecycle.ts";
import { connection } from "./setup.ts";
import { instanceDir, localName } from "./state.ts";

const noInstance = (name: string) =>
  fail("NOT_FOUND", `There is no local instance named ${name}.`, {
    suggestion: `Create one with: ${command("init", "--local", "--name", name)}`,
  });

const configurationToken = (data: Parameters<typeof localAccess>[0]) =>
  Effect.flatMap(localAccess(data), (value) =>
    Option.match(value, {
      onNone: () =>
        Effect.fail(
          fail(
            "STORE_AUTH_INVALID",
            "No local admin credentials are available."
          )
        ),
      onSome: Effect.succeed,
    })
  );

// Starts an instance, or creates it from the project's definition when this checkout
// does not have it yet. On first setup, the project's configuration is applied before
// the store counts as ready, unless the definition says `configure: never`.
const start = (name: string, input: StartOptions) =>
  Effect.gen(function* () {
    yield* localName(name);
    const context = projectLocalOf(name);
    const existing = yield* planDown(name);

    if (existing === undefined && Option.isNone(context)) {
      return yield* noInstance(name);
    }

    if (
      existing !== undefined &&
      Option.isSome(context) &&
      !hasBinding(context.value.project.root, context.value.alias)
    ) {
      return yield* fail(
        "LOCAL_STATE_ERROR",
        `An instance already occupies this checkout's generated name. Attach it explicitly with: ${command("init", "--local", "--name", name)}`
      );
    }

    const options = {
      name,
      newPorts: input.newPorts,
      saleorVersion: Option.isSome(context)
        ? context.value.definition.saleor
        : undefined,
      sampleData: false,
      timeout: input.timeout,
    };

    const marker = path.join(instanceDir(name), "project-configured");

    const configure =
      Option.isSome(context) &&
      configuresOnCreate(context.value.definition) &&
      !existsSync(marker) &&
      (existing === undefined ||
        Option.isNone(
          lastInSync(configPath(context.value.project), `local:${name}`)
        ));

    const file = Option.isSome(context)
      ? configPath(context.value.project)
      : "";

    if (configure) {
      const configuration = yield* WorkspaceConfiguration;
      yield* configuration.validate(file);
    }

    const planned = yield* planUp(options);

    return {
      ...planned,
      action:
        configure && planned.action === "reuse" ? "update" : planned.action,
      apply: Effect.gen(function* () {
        if (Option.isSome(context)) {
          yield* Effect.sync(() => {
            saveBinding(context.value.project.root, context.value.alias, name);
          });
        }

        const data = yield* up(options);

        if (configure) {
          const token = yield* configurationToken(data);

          const configuration = yield* WorkspaceConfiguration;
          yield* configuration.apply(data, token, file);

          yield* Effect.sync(() => {
            writeFileSync(marker, "configured\n");
          });
        }

        return result(data, connection(data).join("\n"));
      }),
      details: { configure, saleorVersion: options.saleorVersion ?? null },
      risk: null,
      target: localTarget(name),
    } satisfies Planned<Ensured<Started>, unknown>;
  });

// Stops the instance, and with `deleteData` deletes it too. Stopping or deleting one
// that does not exist succeeds.
const removal = (name: string, deleteData: boolean) =>
  Effect.gen(function* () {
    yield* localName(name);
    const details = yield* planDown(name);

    if (details === undefined) {
      return absent(localTarget(name));
    }

    let action: "delete" | "none" | "stop" = "stop";

    if (deleteData) {
      action = "delete";
    } else if (details.state === "stopped") {
      action = "none";
    }

    return {
      action,
      apply: down(name, deleteData),
      details: { ...details, deleteData },
      risk: deleteData
        ? "Its database, media and saved credentials are deleted. This cannot be undone."
        : null,
      state: details.state,
      target: localTarget(name),
    } satisfies Planned<object, unknown>;
  });

// Local instances as stores the CLI's commands work with. Refs are `local:<name>`.
export const localInstances = {
  access: localAccess,
  find: (name: string) =>
    Effect.map(list, (instances) =>
      Option.fromUndefinedOr(instances.find((found) => found.name === name))
    ),
  kind: "local",
  label: "Docker",
  list,
  // The same bootstrap as `init --local --sample-data`, on an existing instance.
  populate: (instance: Instance) =>
    Effect.asVoid(
      up({
        name: instance.name,
        saleorVersion: undefined,
        sampleData: true,
        timeout: DEFAULT_WAIT_SECONDS,
      })
    ),
  remove: (name: string) => removal(name, true),
  start,
  stop: (name: string) => removal(name, false),
} satisfies InstanceSource<unknown>;
