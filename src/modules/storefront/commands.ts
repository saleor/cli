import { Effect, Option } from "effect";
import { Command } from "effect/cli";
import { defineActions, defineGroup, type Planned } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { envInput, resolveStore } from "../../core/stores.ts";
import { isInteractive } from "../../core/interaction.ts";
import { MenuAvailable } from "../../core/menu.ts";
import { notice } from "../../core/output.ts";
import { storefrontFolder } from "./project.ts";
import {
  connectedElsewhere,
  create,
  DEFAULT_CHANNEL,
  finish,
  inspect,
  notStorefront,
  shown,
  storefrontTarget,
  TEMPLATE,
} from "./storefront.ts";

// Storefront actions need no login of their own: picking a Cloud store offers one.
const storefront = defineActions();

const channelInput = (description: string) =>
  option.string("channel", {
    default: DEFAULT_CHANNEL,
    description,
    metavar: "slug",
  });

const summary = ({
  dir,
  ref,
  channel,
  install,
}: {
  readonly dir: string;
  readonly ref: string;
  readonly channel: string;
  readonly install: boolean | undefined;
}) =>
  [
    ["Template", `${TEMPLATE.repository} (${TEMPLATE.ref})`],
    ["Directory", shown(dir)],
    ["Store", ref],
    ["Channel", channel],
    ...(install === undefined
      ? []
      : [["Install", install ? "pnpm install" : "no"] as const]),
  ] as const;

const createCommand = storefront.ensure({
  description: `Download the Saleor storefront template (${TEMPLATE.repository}, as it is on ${TEMPLATE.ref}) into a new directory and connect it to a store: its .env gets the store's GraphQL API and channel. Inside a project, it goes in the project's storefront folder and is listed in saleor.yml as a component. The directory becomes a git repository unless it is inside one. In a terminal, it asks for the store. Dependencies are installed automatically. Running it again on the same directory and store reuses the files and retries dependency installation.`,
  examples: [
    {
      command: "saleor storefront create local",
      description: "Create the project's storefront for its local environment",
    },
    {
      command: "saleor storefront create cloud:acme/env1 --dir shop",
      description: "Create ./shop for a Cloud environment",
    },
  ],
  inputs: {
    channel: channelInput(
      "Channel slug the storefront shows. Checked against the store when it answers."
    ),
    dir: option.string("dir", {
      description:
        "Directory to create it in, relative to the current one. Must be new or empty.",
      metavar: "path",
    }),
    env: envInput,
  },
  name: "create",
  plan: (input) =>
    Effect.gen(function* () {
      const dir = storefrontFolder(input.dir, "storefront");
      const found = yield* inspect(dir);

      if (found.kind === "other") {
        return yield* notStorefront(dir);
      }

      const { source, store } = yield* resolveStore(input.env);

      if (
        found.kind === "storefront" &&
        found.ref !== undefined &&
        found.ref !== store.ref
      ) {
        return yield* connectedElsewhere(dir, found.ref, store.ref);
      }

      const channel = Option.getOrElse(input.channel, () => DEFAULT_CHANNEL);

      // Not connected yet: new, or downloaded by a run that stopped before connecting
      // it, which this run finishes and counts as created.
      const unconnected = found.kind === "absent" || found.ref === undefined;

      const connected =
        found.kind === "storefront" &&
        found.ref === store.ref &&
        found.channel === channel;

      const spec = {
        channel,
        created: unconnected,
        dir,
        install: true,
        record: true,
        repository: unconnected ? dir : undefined,
        source,
        store,
      };

      let action: "create" | "reuse" | "update" = "update";

      if (unconnected) {
        action = "create";
      } else if (connected) {
        action = "reuse";
      }

      return {
        action,
        apply: found.kind === "absent" ? create(spec) : finish(spec),
        details: {
          channel,
          directory: dir,
          install: true,
          store: store.ref,
          template: TEMPLATE.repository,
        },
        risk: null,
        state: found.kind === "absent" ? "absent" : "exists",
        summary: summary({
          dir,
          ref: store.ref,
          channel,
          install: true,
        }),
        target: storefrontTarget(dir),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Create a new storefront from the Saleor template.",
});

const useCommand = storefront
  .ensure({
    description:
      "Point an existing storefront at another store: set the store's GraphQL API and channel in its .env, keeping every other line. Works on storefronts the CLI did not create. Defaults to the project's storefront, or the current directory outside a project. Changes local configuration only; restart the development server to use it.",
    examples: [
      {
        command: "saleor storefront use staging",
        description: "Point the project's storefront at staging",
      },
      {
        command: "saleor storefront use cloud:acme/env1 --dir shop",
        description: "Point ./shop at a Cloud environment",
      },
    ],
    inputs: {
      channel: option.string("channel", {
        description: `Channel slug the storefront shows. Keeps the current one when left out (${DEFAULT_CHANNEL} if there is none).`,
        metavar: "slug",
      }),
      dir: option.string("dir", {
        description:
          "The storefront's directory. Defaults to the project storefront, or the current directory outside a project.",
        metavar: "path",
      }),
      env: envInput,
    },
    name: "use",
    plan: (input) =>
      Effect.gen(function* () {
        const dir = storefrontFolder(input.dir, ".");

        const found = yield* inspect(dir);

        if (found.kind !== "storefront") {
          return yield* fail(
            "NOT_FOUND",
            `No Saleor storefront found at "${dir}".`,
            {
              suggestion:
                "Run this inside your storefront directory, or pass its path with --dir <path>.",
            }
          );
        }

        const previous = found.ref ?? found.graphqlUrl ?? "not configured";

        if (yield* isInteractive) {
          yield* notice(
            `Current Saleor environment: ${previous}\nChannel: ${found.channel ?? DEFAULT_CHANNEL}`
          );
        }

        const { source, store } = yield* resolveStore(input.env);

        const channel = Option.getOrElse(
          input.channel,
          () => found.channel ?? DEFAULT_CHANNEL
        );

        const same =
          found.ref === store.ref &&
          found.graphqlUrl === store.graphqlUrl &&
          found.channel === channel;

        return {
          action: same ? "reuse" : "update",
          apply: Effect.map(
            finish({
              channel,
              created: false,
              dir,
              install: false,
              record: false,
              repository: undefined,
              source,
              store,
            }),
            (outcome) =>
              result(
                {
                  ...outcome.data,
                  next: [
                    ...(shown(dir) === "." ? [] : [`cd ${shown(dir)}`]),
                    "pnpm dev",
                  ],
                  previous,
                },
                [
                  `Local storefront now uses ${store.ref} (${store.graphqlUrl}).`,
                  `Channel: ${channel}`,
                  ...outcome.data.warnings.map(
                    (warning) => `Warning: ${warning}`
                  ),
                  "Restart your storefront development server to use the updated configuration.",
                ].join("\n")
              )
          ),
          details: {
            channel,
            directory: dir,
            previous,
            store: store.ref,
          },
          risk: null,
          state: "exists",
          summary: [
            ["Directory", shown(dir)],
            ["Store", `${previous} → ${store.ref}`],
            ["Channel", channel],
          ],
          target: storefrontTarget(dir),
        } satisfies Planned<unknown, unknown>;
      }),
    summary: "Connect the storefront to another store.",
  })
  .pipe(
    Command.annotate(
      MenuAvailable,
      Effect.suspend(() =>
        Effect.map(
          inspect(process.cwd()),
          (found) => found.kind === "storefront"
        )
      )
    )
  );

export const storefrontCommand = defineGroup({
  actions: [createCommand, useCommand],
  description: `Storefronts from the Saleor template (${TEMPLATE.repository}), connected to a store. Name the store with the word after the command, as in every command: a name from saleor.yml or a store ref (cloud:<org>/<env key>, local:<name>); in a terminal, it is picked.`,
  name: "storefront",
  summary: "Create a storefront and connect it to a store.",
});
