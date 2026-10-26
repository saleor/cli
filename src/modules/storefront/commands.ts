import path from "node:path";
import { Effect, Option } from "effect";
import { defineActions, defineGroup, type Planned } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { instanceInput, resolveInstance } from "../../core/instances.ts";
import { command } from "../../core/invocation.ts";
import {
  askInstall,
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

const summary = (
  dir: string,
  ref: string,
  channel: string,
  install: boolean | undefined
) =>
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
  description: `Download the Saleor storefront template (${TEMPLATE.repository}, as it is on ${TEMPLATE.ref}) into a new directory and connect it to a store: its .env gets the store's GraphQL API and channel. The directory becomes a git repository unless it is inside one. In a terminal, it asks for the store and whether to install dependencies. Running it again on the same directory and store changes nothing.`,
  examples: [
    {
      command: "saleor storefront create --instance local:demo",
      description: "Create ./storefront connected to a local store",
    },
    {
      command:
        "saleor storefront create --instance cloud:acme/env1 --dir shop --install",
      description: "Create ./shop for a Cloud environment and install it",
    },
  ],
  inputs: {
    channel: channelInput(
      "Channel slug the storefront shows. Checked against the store when it answers."
    ),
    dir: option.string("dir", {
      default: "storefront",
      description:
        "Directory to create it in, relative to the current one. Must be new or empty.",
      metavar: "path",
    }),
    install: option.boolean(
      "install",
      "Install its dependencies with pnpm. Asked in a terminal."
    ),
    instance: instanceInput,
  },
  name: "create",
  plan: (input) =>
    Effect.gen(function* () {
      const dir = path.resolve(Option.getOrElse(input.dir, () => "storefront"));
      const found = yield* inspect(dir);

      if (found.kind === "other") {
        return yield* notStorefront(dir);
      }

      const { instance: store, source } = yield* resolveInstance(
        input.instance
      );

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

      const install = connected
        ? input.install
        : yield* askInstall(input.install);

      const spec = {
        channel,
        created: unconnected,
        dir,
        install,
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
          install,
          store: store.ref,
          template: TEMPLATE.repository,
        },
        risk: null,
        state: found.kind === "absent" ? "absent" : "exists",
        summary: summary(dir, store.ref, channel, install),
        target: storefrontTarget(dir),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Create a storefront connected to a store.",
});

const notFound = (dir: string) =>
  fail("NOT_FOUND", `There is no Saleor storefront in ${shown(dir)}.`, {
    suggestion: `Pass its directory with --dir, or create one with: ${command("storefront", "create")}`,
  });

const connectCommand = storefront.ensure({
  description:
    "Connect an existing Saleor storefront to a store: set the store's GraphQL API and channel in its .env, keeping every other line. Works on storefronts the CLI did not create. Without --dir, uses the current directory if it is a storefront, else ./storefront.",
  examples: [
    {
      command: "saleor storefront connect --instance cloud:acme/env1",
      description: "Point the storefront here at a Cloud environment",
    },
  ],
  inputs: {
    channel: option.string("channel", {
      description: `Channel slug the storefront shows. Keeps the current one when left out (${DEFAULT_CHANNEL} if there is none).`,
      metavar: "slug",
    }),
    dir: option.string("dir", {
      description:
        "The storefront's directory. Defaults to the current one if it is a storefront, else ./storefront.",
      metavar: "path",
    }),
    instance: instanceInput,
  },
  name: "connect",
  plan: (input) =>
    Effect.gen(function* () {
      const here = yield* inspect(process.cwd());

      const dir = path.resolve(
        Option.getOrElse(input.dir, () =>
          here.kind === "storefront" ? "." : "storefront"
        )
      );

      const found = yield* inspect(dir);

      if (found.kind !== "storefront") {
        return yield* notFound(dir);
      }

      const { instance: store, source } = yield* resolveInstance(
        input.instance
      );

      const channel = Option.getOrElse(
        input.channel,
        () => found.channel ?? DEFAULT_CHANNEL
      );

      const same = found.ref === store.ref && found.channel === channel;

      return {
        action: same ? "reuse" : "update",
        apply: finish({
          channel,
          created: false,
          dir,
          install: false,
          repository: undefined,
          source,
          store,
        }),
        details: {
          channel,
          directory: dir,
          previous: found.ref ?? null,
          store: store.ref,
        },
        risk: null,
        state: "exists",
        summary: [
          ["Directory", shown(dir)],
          ["Store", `${found.ref ?? "none"} → ${store.ref}`],
          ["Channel", channel],
        ],
        target: storefrontTarget(dir),
      } satisfies Planned<unknown, unknown>;
    }),
  summary: "Connect a storefront to another store.",
});

export const storefrontCommand = defineGroup({
  actions: [createCommand, connectCommand],
  description: `Create a storefront from the Saleor template (${TEMPLATE.repository}) connected to a store, or connect an existing one to another store. Stores are given as refs (cloud:<org>/<env key>, local:<name>), or picked in a terminal.`,
  name: "storefront",
  summary: "Create and connect storefronts.",
});
