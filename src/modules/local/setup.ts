import { Effect, Option } from "effect";
import type { Planned } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { option } from "../../core/inputs.ts";
import { defineSetup } from "../../core/setup.ts";
import { SALEOR_VERSION } from "./compose.ts";
import { type LocalUpOptions, localTarget, planUp, up } from "./lifecycle.ts";
import { instance, instanceChoices } from "./targets.ts";

const connection = (data: {
  readonly graphqlUrl: string;
  readonly dashboardUrl: string | null;
  readonly mailUrl: string | null;
  readonly admin: { readonly email: string; readonly password: string | null };
}) =>
  [
    `  GraphQL API: ${data.graphqlUrl}`,
    `  Dashboard:   ${data.dashboardUrl}`,
    data.mailUrl === null ? "" : `  Mail inbox:  ${data.mailUrl}`,
    `  Admin email: ${data.admin.email}`,
    data.admin.password === null ? "" : `  Password:    ${data.admin.password}`,
  ].filter(Boolean);

const newInstance = instance.input({ creates: true });

// `saleor init --local`: create a local instance, or start an existing one, and print
// how to reach it and log in. Running it again on a running instance only prints that.
export const localSetup = defineSetup({
  example: {
    command: "saleor init --local",
    description: "Start a local store with Docker",
  },
  flag: "local",
  hint: "Docker on this computer, no login needed",
  inputs: {
    name: newInstance,
    newPorts: option.boolean(
      "new-ports",
      "Move a local instance to new free ports, for when another program took one. Its URLs change; data is kept."
    ),
    saleorVersion: option.string("saleor-version", {
      default: SALEOR_VERSION,
      description: "Saleor API version for a new local instance.",
      metavar: "version",
    }),
    sampleData: option.boolean(
      "sample-data",
      "Load sample products and orders into a local instance. Can be added to an existing one; never removed."
    ),
  },
  label: "Docker",
  name: "local",
  plan: (input) =>
    Effect.gen(function* () {
      const name = yield* newInstance.resolve(input.name, {
        choices: instanceChoices,
        create: {
          label: "Create a new instance",
          prompt: "Local instance name",
        },
      });

      const options: LocalUpOptions = {
        name,
        newPorts: input.newPorts,
        saleorVersion: Option.getOrUndefined(input.saleorVersion),
        sampleData: input.sampleData,
        timeout: input.timeout,
      };

      const planned = yield* planUp(options);

      return {
        action: planned.action,
        apply: Effect.map(up(options), (data) =>
          result(data, connection(data).join("\n"))
        ),
        details: {
          saleorVersion: options.saleorVersion ?? SALEOR_VERSION,
          sampleData: options.sampleData,
        },
        risk: null,
        state: planned.state,
        target: localTarget(name),
      } satisfies Planned<unknown, unknown>;
    }),
});
