import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Effect, Option } from "effect";
import {
  absent,
  defineGroup,
  listing,
  type Planned,
} from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import {
  configPath,
  hasBinding,
  lastInSync,
  projectLocal,
  saveBinding,
} from "../../core/project.ts";
import { WorkspaceConfiguration } from "../../core/workspace-configuration.ts";
import { localAccess } from "./access.ts";
import { down, list, localTarget, planDown, planUp, up } from "./lifecycle.ts";
import { connection } from "./setup.ts";
import { instanceDir, startCommand } from "./state.ts";
import {
  instance,
  instanceChoices,
  local,
  noInstancesHint,
} from "./targets.ts";

const localList = local.list({
  description:
    "List local instances on this computer, whether each one is running, and their URLs. Start one with saleor local up.",
  inputs: {},
  name: "list",
  run: () =>
    Effect.map(list, (instances) =>
      listing(
        instances,
        [
          ["NAME", (i) => i.name],
          ["STATE", (i) => i.state],
          ["VERSION", (i) => i.saleorVersion],
          ["GRAPHQL API", (i) => i.graphqlUrl],
          ["DASHBOARD", (i) => i.dashboardUrl],
        ],
        `No local instances. ${noInstancesHint}`
      )
    ),
  summary: "List local instances.",
});

const existingInstance = instance.input();

const localUp = local.ensure({
  description:
    "Start the project local environment, creating it from saleor.yml when needed, or start an explicitly named instance. Apply project configuration on first setup when configure is on-create.",
  inputs: {
    name: existingInstance,
    newPorts: option.boolean(
      "new-ports",
      "Move the instance to new free ports, keeping its data."
    ),
  },
  name: "up",
  plan: (input) =>
    Effect.gen(function* () {
      const context = Option.isNone(input.name)
        ? projectLocal()
        : Option.none();

      const name = yield* existingInstance.resolve(
        Option.orElse(input.name, () =>
          Option.map(context, (value) => value.name)
        ),
        {
          choices: instanceChoices,
          emptyHint: noInstancesHint,
        }
      );

      const existing = yield* planDown(name);

      if (existing === undefined && Option.isNone(context)) {
        return yield* fail(
          "NOT_FOUND",
          `There is no local instance named ${name}.`,
          { suggestion: noInstancesHint }
        );
      }

      if (
        existing !== undefined &&
        Option.isSome(context) &&
        !hasBinding(context.value.project.root, context.value.alias)
      ) {
        return yield* fail(
          "LOCAL_STATE_ERROR",
          "An instance already occupies this checkout's generated name. Attach it explicitly with saleor init --local --name " +
            name
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
        context.value.definition.configure === "on-create" &&
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
            yield* Effect.sync(() =>
              saveBinding(context.value.project.root, context.value.alias, name)
            );
          }

          const data = yield* up(options);

          if (configure) {
            const token = yield* Effect.flatMap(localAccess(data), (value) =>
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

            const configuration = yield* WorkspaceConfiguration;
            yield* configuration.apply(data, token, file);

            yield* Effect.sync(() => writeFileSync(marker, "configured\n"));
          }

          return result(data, connection(data).join("\n"));
        }),
        details: { configure, saleorVersion: options.saleorVersion ?? null },
        risk: null,
        target: localTarget(name),
      };
    }),
  summary: "Start an existing local instance.",
  waits: true,
});

const DELETE_RISK =
  "Its database, media and saved credentials are deleted. This cannot be undone.";

const planRemoval = (input: Option.Option<string>, deleteData: boolean) =>
  Effect.gen(function* () {
    const name = yield* existingInstance.resolve(
      Option.orElse(input, () =>
        Option.map(projectLocal(), (value) => value.name)
      ),
      {
        choices: instanceChoices,
        emptyHint: noInstancesHint,
      }
    );

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
      risk: deleteData ? DELETE_RISK : null,
      state: details.state,
      target: localTarget(name),
    } satisfies Planned<object, unknown>;
  });

const localDown = local.remove({
  description:
    "Stop a local instance. Data is kept unless --delete-data is confirmed. Stopping an instance that does not exist succeeds.",
  examples: [
    {
      command: "saleor local down --name demo",
      description: "Stop an instance and keep its data",
    },
  ],
  inputs: {
    deleteData: option.boolean(
      "delete-data",
      "Permanently delete the instance's database, media and saved credentials."
    ),
    name: existingInstance,
  },
  name: "down",
  note: (data) =>
    data.action === "stop"
      ? `Its data is kept; start it again with: ${startCommand(data.target.name)}`
      : undefined,
  plan: (input) => planRemoval(input.name, input.deleteData),
  risk: "With --delete-data, permanently deletes the local database, media and saved credentials; otherwise keeps data.",
  summary: "Stop a local instance (keep its data).",
});

const localDelete = local.remove({
  description:
    "Permanently delete a local instance, including its database, media, saved credentials and instance files. Asks for confirmation in a terminal; requires --force otherwise. Deleting an instance that does not exist succeeds.",
  examples: [
    {
      command: "saleor local delete --name demo",
      description: "Delete an instance after confirmation",
    },
    {
      command: "saleor local delete --name demo --dry-run",
      description: "Preview deletion without removing anything",
    },
  ],
  inputs: { name: existingInstance },
  name: "delete",
  plan: (input) => planRemoval(input.name, true),
  risk: DELETE_RISK,
  summary: "Delete a local instance and all its data.",
});

export const localCommand = defineGroup({
  actions: [localList, localUp, localDown, localDelete],
  description:
    "List, start, stop and delete local Saleor instances in Docker. Create one with saleor init --local.",
  name: "local",
  summary: "Manage local environments.",
});
