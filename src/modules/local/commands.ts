import { Effect } from "effect";
import {
  absent,
  defineGroup,
  listing,
  type Planned,
} from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { down, list, localTarget, planDown, planUp, up } from "./lifecycle.ts";
import { connection } from "./setup.ts";
import { startCommand } from "./state.ts";
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
    "Start an existing local instance and print its URLs and admin login. Create a new store with saleor init --local.",
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
      const name = yield* existingInstance.resolve(input.name, {
        choices: instanceChoices,
        emptyHint: noInstancesHint,
      });

      const existing = yield* planDown(name);

      if (existing === undefined) {
        return yield* fail(
          "NOT_FOUND",
          `There is no local instance named ${name}.`,
          { suggestion: noInstancesHint }
        );
      }

      const options = {
        name,
        newPorts: input.newPorts,
        saleorVersion: undefined,
        sampleData: false,
        timeout: input.timeout,
      };

      const planned = yield* planUp(options);

      return {
        ...planned,
        apply: Effect.map(up(options), (data) =>
          result(data, connection(data).join("\n"))
        ),
        details: {},
        risk: null,
        target: localTarget(name),
      };
    }),
  summary: "Start an existing local instance.",
  waits: true,
});

const localDown = local.remove({
  description:
    "Stop a local instance. Data is kept unless --delete-data is confirmed. Stopping an instance that does not exist succeeds.",
  examples: [
    {
      command: "saleor local down --name demo --delete-data --force",
      description: "Delete an instance and all its data",
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
  plan: (input) =>
    Effect.gen(function* () {
      const name = yield* existingInstance.resolve(input.name, {
        choices: instanceChoices,
        emptyHint: noInstancesHint,
      });

      const details = yield* planDown(name);

      if (details === undefined) {
        return absent(localTarget(name));
      }

      let action: "delete" | "none" | "stop" = "stop";

      if (input.deleteData) {
        action = "delete";
      } else if (details.state === "stopped") {
        action = "none";
      }

      return {
        action,
        apply: down(name, input.deleteData),
        details: { ...details, deleteData: input.deleteData },
        risk: input.deleteData
          ? "Its database, media and saved credentials are deleted. This cannot be undone."
          : null,
        state: details.state,
        target: localTarget(name),
      } satisfies Planned<object, unknown>;
    }),
  risk: "With --delete-data, permanently deletes the local database, media and saved credentials; otherwise keeps data.",
  summary: "Stop a local instance, optionally deleting it.",
});

export const localCommand = defineGroup({
  actions: [localList, localUp, localDown],
  description:
    "List, start and stop local Saleor instances in Docker. Create one with saleor init --local.",
  name: "local",
  summary: "Manage local stores.",
});
