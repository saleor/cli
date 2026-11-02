import { Effect, Option } from "effect";
import type { Planned } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { hasBinding, projectLocal, slugify } from "../../core/project.ts";
import { defineSetup } from "../../core/setup.ts";
import { SALEOR_VERSION } from "./compose.ts";
import { type LocalUpOptions, localTarget, planUp, up } from "./lifecycle.ts";
import { readConfig } from "./state.ts";
import { instance } from "./targets.ts";

export const connection = (data: {
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

// Create a local store; an explicitly named instance can resume an earlier setup.
export const localSetup = defineSetup({
  example: {
    command: "saleor init --local",
    description: "Create a local store with Docker",
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
  // Local names are shared by every project on this computer, so an environment's
  // instance is named after its project too.
  naming: {
    input: "name",
    name: (project, alias) => {
      const slug = slugify(`${project}-${alias}`);

      return (/^[a-z]/.test(slug) ? slug : `saleor-${slug}`)
        .slice(0, 40)
        .replace(/-+$/, "");
    },
  },
  plan: (input) =>
    Effect.gen(function* () {
      const context = Option.isNone(input.name)
        ? projectLocal()
        : Option.none();

      const name = yield* newInstance.resolve(
        Option.orElse(input.name, () =>
          Option.map(context, (value) => value.name)
        ),
        {
          choices: Effect.succeed([]),
          create: {
            label: "Create a new instance",
            prompt: "New local instance name",
          },
        }
      );

      if (
        Option.isSome(context) &&
        !hasBinding(context.value.project.root, context.value.alias) &&
        (yield* readConfig(name)) !== undefined
      ) {
        return yield* fail(
          "LOCAL_STATE_ERROR",
          `An instance already occupies this checkout's generated name. Attach it explicitly with saleor init --local --name ${name}`
        );
      }

      const options: LocalUpOptions = {
        name,
        newPorts: input.newPorts,
        saleorVersion: Option.getOrElse(input.saleorVersion, () =>
          Option.isSome(context)
            ? context.value.definition.saleor
            : SALEOR_VERSION
        ),
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
