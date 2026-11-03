import { Effect, Option } from "effect";
import {
  absent,
  DEFAULT_WAIT_SECONDS,
  type Ensured,
  type Planned,
} from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import type {
  Store,
  StoreSource,
  StartOptions,
  Started,
} from "../../core/store.ts";
import { command } from "../../core/invocation.ts";
import { configuresOnCreate } from "../../core/manifest.ts";
import {
  configPath,
  hasBinding,
  projectLocalOf,
  saveBinding,
} from "../../core/project.ts";
import {
  applyConfiguration,
  configurationPending,
  validateConfiguration,
} from "../../core/project-configuration.ts";
import { localRef } from "../../core/ref.ts";
import { localStaffToken } from "./staff-token.ts";
import { down, list, localTarget, planDown, planUp, up } from "./lifecycle.ts";
import { connection } from "./setup.ts";
import { localName } from "./state.ts";

const noInstance = (name: string) =>
  fail("NOT_FOUND", `There is no local store named ${name}.`, {
    suggestion: `Create one with: ${command("init", "--local", "--name", name)}`,
  });

const configurationToken = (data: Parameters<typeof localStaffToken>[0]) =>
  Effect.flatMap(localStaffToken(data), (value) =>
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
        `A store already occupies this checkout's generated name. Attach it explicitly with: ${command("init", "--local", "--name", name)}`
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

    const file = Option.isSome(context)
      ? configPath(context.value.project)
      : "";

    const configure =
      Option.isSome(context) &&
      configuresOnCreate(context.value.definition) &&
      configurationPending(file, localRef(name), existing === undefined);

    if (configure) {
      yield* validateConfiguration(file);
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
          yield* applyConfiguration({ store: data, token }, file);
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

// Local stores, in Docker on this computer. Refs are `local:<name>`.
export const localStores = {
  find: (name: string) =>
    Effect.map(list, (stores) =>
      Option.fromUndefinedOr(stores.find((found) => found.name === name))
    ),
  kind: "local",
  label: "Docker",
  list,
  // The same bootstrap as `init --local --sample-data`, on an existing instance.
  populate: (store: Store) =>
    Effect.asVoid(
      up({
        name: store.name,
        saleorVersion: undefined,
        sampleData: true,
        timeout: DEFAULT_WAIT_SECONDS,
      })
    ),
  remove: (name: string) => removal(name, true),
  start,
  staffToken: localStaffToken,
  stop: (name: string) => removal(name, false),
  token: localStaffToken,
} satisfies StoreSource<unknown>;
