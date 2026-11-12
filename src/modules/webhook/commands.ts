import { Effect, Option } from "effect";
import { readFileSync } from "node:fs";
import { defineActions, defineGroup } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { askText, isInteractive } from "../../core/interaction.ts";
import type { Store } from "../../core/store.ts";
import {
  envInput,
  type ResolvedStore,
  resolveStore,
} from "../../core/stores.ts";
import { command, recordAnswer } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import type { StoreClient } from "../../core/store-api.ts";
import { storeToken } from "../../core/store-token.ts";
import { deleteApp } from "../../core/store-apps.ts";
import { createApp, subscribe } from "./app.ts";
import { listen } from "./listener.ts";
import { receiveUntil, showDelivery, untilCtrlC } from "./stream.ts";

const webhook = defineActions();

// Saleor's event names, from however they were typed: order_created, order.created.
export const eventNames = (input: Option.Option<string>) =>
  Option.match(input, {
    onNone: () => [],
    onSome: (raw) =>
      raw
        .split(",")
        .map((each) =>
          each
            .trim()
            .toUpperCase()
            .replaceAll(/[.\s-]/g, "_")
        )
        .filter((each) => each !== ""),
  });

const readSubscription = (file: Option.Option<string>) =>
  Option.match(file, {
    onNone: () => Effect.succeed(undefined),
    onSome: (path) =>
      Effect.try({
        catch: () => fail("USAGE_ERROR", `Could not read "${path}".`),
        try: () => readFileSync(path, "utf-8"),
      }),
  });

// Where the store can reach this computer: a local store in Docker through Docker's
// name for the host, anything else only through a tunnel the person runs.
const reachable = (
  store: Store,
  input: { readonly port: number; readonly publicUrl: Option.Option<string> }
) =>
  Effect.gen(function* () {
    if (Option.isSome(input.publicUrl)) {
      if (input.port === 0) {
        return yield* fail(
          "USAGE_ERROR",
          "--public-url needs --port: the port your tunnel forwards to."
        );
      }

      return {
        base: input.publicUrl.value.replace(/\/+$/, ""),
        host: "127.0.0.1",
      };
    }

    if (store.kind !== "local") {
      return yield* fail(
        "USAGE_ERROR",
        `${store.ref} cannot reach this computer by itself.`,
        {
          suggestion: `Start a tunnel to a local port (for example: cloudflared tunnel --url http://localhost:4141), then run: ${command("webhook", "listen", store.ref, "--port", "4141", "--public-url", "<tunnel url>")}`,
        }
      );
    }

    // Docker Desktop routes host.docker.internal to this computer's loopback; on Linux
    // it is the bridge's gateway, so the listener has to accept more than loopback.
    // The random path keeps everyone but the store from delivering.
    return {
      base: null,
      host: process.platform === "linux" ? "0.0.0.0" : "127.0.0.1",
    };
  });

// Deleting the temporary app when listening stops, which can be long after the token
// was made: a local store's login lasts minutes, so a refused token is made again
// once, by the store's source itself (never a prompt, while stopping).
const deleteAgain = (
  { store, source }: ResolvedStore,
  client: StoreClient,
  id: string
) =>
  deleteApp(client, id).pipe(
    Effect.catchIf(
      (failure) =>
        failure.code === "STORE_AUTH_INVALID" && source.token !== undefined,
      (failure) =>
        Effect.flatMap(
          source.token?.(store) ?? Effect.succeedNone,
          Option.match({
            onNone: () => Effect.fail(failure),
            onSome: (token) => deleteApp({ store, token }, id),
          })
        )
    )
  );

// The events to listen for: --events, else asked in a terminal. A subscription names
// its own, so then none are needed.
const eventsFrom = (
  given: Option.Option<string>,
  subscription: string | undefined
) =>
  Effect.gen(function* () {
    const events = eventNames(given);

    if (events.length > 0 || subscription !== undefined) {
      return events;
    }

    if (!(yield* isInteractive)) {
      return yield* fail("CONTEXT_MISSING", "Name the events to listen for.", {
        suggestion:
          "Pass --events order_created,checkout_updated, or a subscription query with --subscription <path>.",
      });
    }

    const answer = yield* askText({
      message: "Which events? Separate them with commas.",
      placeholder: "order_created,checkout_updated",
      validate: (value) =>
        eventNames(Option.some(value)).length === 0
          ? "Name at least one event."
          : undefined,
    });

    yield* recordAnswer({ option: ["--events", answer] });

    return eventNames(Option.some(answer));
  });

const listenCommand = webhook.session({
  description:
    "Receive a store's webhooks on this computer and print each one as it arrives, until Ctrl+C or --count deliveries. It creates a temporary app on the store with a webhook for the events (or for a subscription query), and deletes it when it stops. With --forward-to, each delivery is also sent on to your app, headers and signature included, and the store gets your app's answer. Local stores in Docker reach this computer directly; any other store needs a tunnel: pass its address with --public-url and the port it forwards to with --port. The token needs MANAGE_APPS and the permissions the events need. In json mode, each delivery is a JSON line on stderr, and the result lists them all.",
  examples: [
    {
      command: "saleor webhook listen local --events order_created",
      description: "Print orders as they are created in the local store",
    },
    {
      command:
        "saleor webhook listen local --subscription order.graphql --forward-to http://localhost:3000/api/webhooks/order-created",
      description: "Forward a subscription's payloads to your app",
    },
    {
      command:
        "saleor webhook listen staging --events checkout_updated --port 4141 --public-url https://abc.trycloudflare.com",
      description: "Listen on a Cloud store through a tunnel",
    },
  ],
  inputs: {
    count: option.integer("count", {
      default: 0,
      description: "Stop after this many deliveries; 0 listens until Ctrl+C.",
      metavar: "n",
      minimum: 0,
    }),
    env: envInput,
    events: option.string("events", {
      description:
        "Comma-separated events: order_created,checkout_updated. Optional with --subscription, which names its own.",
      metavar: "events",
    }),
    forwardTo: option.string("forward-to", {
      description:
        "Also send each delivery to this URL, such as your app's webhook route.",
      metavar: "url",
    }),
    port: option.integer("port", {
      default: 0,
      description: "Port to listen on; 0 picks a free one.",
      metavar: "port",
      minimum: 0,
    }),
    publicUrl: option.string("public-url", {
      description:
        "Public address of a tunnel to --port, for stores outside Docker on this computer.",
      metavar: "url",
    }),
    subscription: option.string("subscription", {
      description:
        "A file with a GraphQL subscription that shapes the payload, as an app's webhook would.",
      metavar: "path",
    }),
  },
  name: "listen",
  run: (input) =>
    Effect.gen(function* () {
      const subscription = yield* readSubscription(input.subscription);
      const events = yield* eventsFrom(input.events, subscription);

      const resolved = yield* resolveStore(input.env);
      const { store } = resolved;
      const where = yield* reachable(store, input);

      const { token } = yield* storeToken(resolved, {
        needs: "MANAGE_APPS and the permissions the events need",
        // Saleor lets only a staff user create the temporary app.
        staff: true,
      });

      const client: StoreClient = { store, token };

      const forwardTo = Option.getOrUndefined(input.forwardTo);

      return yield* untilCtrlC(
        Effect.scoped(
          Effect.gen(function* () {
            const listening = yield* listen({
              forwardTo,
              host: where.host,
              port: input.port,
            });

            const targetUrl = `${where.base ?? `http://host.docker.internal:${listening.port}`}${listening.path}`;

            const app = yield* Effect.acquireRelease(
              createApp(client),
              (made) =>
                deleteAgain(resolved, client, made.id).pipe(
                  Effect.matchEffect({
                    onFailure: () =>
                      notice(
                        `Could not delete the temporary app "${made.name}"; delete it in the store's Dashboard (Apps).`
                      ),
                    onSuccess: () =>
                      notice(`Deleted the temporary app "${made.name}".`),
                  })
                )
            );

            const hook = yield* subscribe(client, {
              app: app.id,
              events,
              subscription,
              targetUrl,
            });

            yield* notice(
              [
                `Listening for ${hook.events.join(", ")} on ${store.ref}.`,
                ...(forwardTo === undefined
                  ? []
                  : [`Forwarding to ${forwardTo}.`]),
                input.count === 0
                  ? "Press Ctrl+C to stop."
                  : `Stopping after ${input.count} ${input.count === 1 ? "delivery" : "deliveries"}.`,
              ].join(" "),
              { port: listening.port, store: store.ref, targetUrl }
            );

            const deliveries = yield* receiveUntil(
              listening.deliveries,
              input.count,
              showDelivery
            );

            return result(
              { app, deliveries, store: store.ref, webhook: hook },
              `✓ Received ${deliveries.length} ${deliveries.length === 1 ? "delivery" : "deliveries"} from ${store.ref}.`
            );
          })
        )
      );
    }),
  summary: "Watch a store's webhooks and forward them to your app.",
});

export const webhookCommand = defineGroup({
  actions: [listenCommand],
  description:
    "A store's webhooks, received on this computer. Name the store with the word after the command, as in every command: a name from saleor.yml or a store ref (cloud:<org>/<env key>, local:<name>).",
  name: "webhook",
  summary: "Receive a store's webhooks while you build.",
});
