import { Effect, Option } from "effect";
import type { InstanceSource } from "../../core/instance.ts";
import { command } from "../../core/invocation.ts";
import { list } from "./lifecycle.ts";
import { startCommand } from "./state.ts";

// Local instances as stores other modules can connect to. Refs are `local:<name>`.
export const localInstances = {
  find: (name: string) =>
    Effect.map(list, (instances) =>
      Option.fromUndefinedOr(instances.find((found) => found.name === name))
    ),
  kind: "local",
  label: "Docker",
  list,
  listCommand: command("local", "list"),
  startCommand: (name: string) => startCommand(name),
} satisfies InstanceSource<unknown>;
