import { Effect, Schema } from "effect";
import { randomBytes } from "node:crypto";
import {
  mutationRejected,
  MutationErrors,
  PermissionCodes,
  type StoreClient,
  storeData,
  storeQuery,
} from "../../core/store-api.ts";

// The temporary app a listener subscribes through. Saleor delivers webhooks to apps,
// so `webhook listen` makes one, gives it what the token's owner may grant, and
// deletes it when it stops. Deleting an app deletes its webhooks.

export const APP_NAME_PREFIX = "Saleor CLI listener";

const Requester = Schema.Struct({
  me: Schema.NullOr(Schema.Struct({ userPermissions: PermissionCodes })),
});

const RequestingApp = Schema.Struct({
  app: Schema.NullOr(Schema.Struct({ permissions: PermissionCodes })),
});

const AppCreated = Schema.Struct({
  appCreate: Schema.Struct({
    app: Schema.NullOr(
      Schema.Struct({ id: Schema.String, name: Schema.String })
    ),
    errors: MutationErrors,
  }),
});

const WebhookCreated = Schema.Struct({
  webhookCreate: Schema.Struct({
    errors: MutationErrors,
    webhook: Schema.NullOr(
      Schema.Struct({
        asyncEvents: PermissionCodes,
        id: Schema.String,
        targetUrl: Schema.String,
      })
    ),
  }),
});

// What the token may grant: a staff member's permissions, or an app's own.
const grantable = (client: StoreClient) =>
  Effect.gen(function* () {
    const user = yield* storeData(client, Requester, {
      query: "query { me { userPermissions { code } } }",
    });

    if (user.me !== null) {
      return user.me.userPermissions.map((each) => each.code);
    }

    const app = yield* storeData(client, RequestingApp, {
      query: "query { app { permissions { code } } }",
    });

    return app.app?.permissions.map((each) => each.code) ?? [];
  });

export interface Listener {
  readonly app: { readonly id: string; readonly name: string };
  readonly webhook: {
    readonly events: readonly string[];
    readonly id: string;
    readonly targetUrl: string;
  };
}

export const createApp = (client: StoreClient) =>
  Effect.gen(function* () {
    const permissions = yield* grantable(client);
    const name = `${APP_NAME_PREFIX} ${randomBytes(3).toString("hex")}`;

    const created = yield* storeData(client, AppCreated, {
      query:
        "mutation($input: AppInput!) { appCreate(input: $input) { app { id name } errors { field message code } } }",
      variables: { input: { name, permissions } },
    });

    const { app, errors } = created.appCreate;

    if (app === null) {
      return yield* mutationRejected(
        client.store,
        "create the listener app",
        errors
      );
    }

    return app;
  });

export const deleteApp = (client: StoreClient, id: string) =>
  storeQuery(client.store, {
    query: "mutation($id: ID!) { appDelete(id: $id) { errors { message } } }",
    token: client.token,
    variables: { id },
  });

export const subscribe = (
  client: StoreClient,
  spec: {
    readonly app: string;
    readonly events: readonly string[];
    readonly subscription: string | undefined;
    readonly targetUrl: string;
  }
) =>
  Effect.gen(function* () {
    const events = {
      app: spec.app,
      asyncEvents: [...spec.events],
      isActive: true,
      name: "saleor webhook listen",
      targetUrl: spec.targetUrl,
    };

    // With a subscription, the payload is its result, and the events default to the
    // ones it names.
    const input =
      spec.subscription === undefined
        ? events
        : { ...events, query: spec.subscription };

    const created = yield* storeData(client, WebhookCreated, {
      query:
        "mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { webhook { id targetUrl asyncEvents { code: eventType } } errors { field message code } } }",
      variables: { input },
    });

    const { errors, webhook } = created.webhookCreate;

    if (webhook === null) {
      return yield* mutationRejected(
        client.store,
        "subscribe to the events",
        errors
      );
    }

    return {
      events: webhook.asyncEvents.map((each) => each.code),
      id: webhook.id,
      targetUrl: webhook.targetUrl,
    } satisfies Listener["webhook"];
  });
