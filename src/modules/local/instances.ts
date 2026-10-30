import { Effect, Option } from "effect";
import { DEFAULT_WAIT_SECONDS } from "../../core/action.ts";
import type { Instance, InstanceSource } from "../../core/instance.ts";
import { command } from "../../core/invocation.ts";
import { localAccess } from "./access.ts";
import { list, up } from "./lifecycle.ts";
import { startCommand } from "./state.ts";

// Local instances as stores other modules can connect to. Refs are `local:<name>`.
export const localInstances = {
  access: localAccess,
  find: (name: string) =>
    Effect.map(list, (instances) =>
      Option.fromUndefinedOr(instances.find((found) => found.name === name))
    ),
  kind: "local",
  label: "Docker",
  list,
  listCommand: command("local", "list"),
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
  startCommand: (name: string) => startCommand(name),
} satisfies InstanceSource<unknown>;
