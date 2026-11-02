import { Effect, Schema } from "effect";
import { randomBytes } from "node:crypto";
import { fail } from "../../core/errors.ts";
import type { Instance } from "../../core/instance.ts";
import { storeQuery } from "../../core/store-api.ts";

// The temporary app a listener subscribes through. Saleor delivers webhooks to apps,
// so `webhook listen` makes one, gives it what the token's owner may grant, and
// deletes it when it stops. Deleting an app deletes its webhooks.

export const APP_NAME_PREFIX = "Saleor CLI listener";

interface Store {
  readonly instance: Instance;
  readonly token: string;
}

const Codes = Schema.Array(Schema.Struct({ code: Schema.String }));

const Requester = Schema.Struct({
  me: Schema.NullOr(Schema.Struct({ userPermissions: Codes })),
});

const RequestingApp = Schema.Struct({
  app: Schema.NullOr(Schema.Struct({ permissions: Codes })),
});

const MutationErrors = Schema.Array(
  Schema.Struct({
    code: Schema.NullOr(Schema.String),
    field: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
  })
);

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
        asyncEvents: Codes,
        id: Schema.String,
        targetUrl: Schema.String,
      })
    ),
  }),
});

const unexpected = (instance: Instance) =>
  fail(
    "STORE_ERROR",
    `${instance.ref} answered in a shape this CLI does not know.`
  );

const query = <S extends Schema.Top>(
  store: Store,
  schema: S,
  request: { readonly query: string; readonly variables?: Schema.JsonObject }
) =>
  storeQuery(store.instance, { ...request, token: store.token }).pipe(
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(schema)(data).pipe(
        Effect.mapError(() => unexpected(store.instance))
      )
    )
  );

type Errors = typeof MutationErrors.Type;

const rejected = (store: Store, what: string, errors: Errors) =>
  fail(
    "STORE_ERROR",
    `${store.instance.ref} did not ${what}: ${errors
      .map((error) =>
        [error.field, error.message ?? error.code].filter(Boolean).join(": ")
      )
      .join("; ")}`,
    { details: { errors } }
  );

// What the token may grant: a staff member's permissions, or an app's own.
const grantable = (store: Store) =>
  Effect.gen(function* () {
    const user = yield* query(store, Requester, {
      query: "query { me { userPermissions { code } } }",
    });

    if (user.me !== null) {
      return user.me.userPermissions.map((each) => each.code);
    }

    const app = yield* query(store, RequestingApp, {
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

export const createApp = (store: Store) =>
  Effect.gen(function* () {
    const permissions = yield* grantable(store);
    const name = `${APP_NAME_PREFIX} ${randomBytes(3).toString("hex")}`;

    const created = yield* query(store, AppCreated, {
      query:
        "mutation($input: AppInput!) { appCreate(input: $input) { app { id name } errors { field message code } } }",
      variables: { input: { name, permissions } },
    });

    const { app, errors } = created.appCreate;

    if (app === null) {
      return yield* rejected(store, "create the listener app", errors);
    }

    return app;
  });

export const deleteApp = (store: Store, id: string) =>
  storeQuery(store.instance, {
    query: "mutation($id: ID!) { appDelete(id: $id) { errors { message } } }",
    token: store.token,
    variables: { id },
  });

export const subscribe = (
  store: Store,
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

    const created = yield* query(store, WebhookCreated, {
      query:
        "mutation($input: WebhookCreateInput!) { webhookCreate(input: $input) { webhook { id targetUrl asyncEvents { code: eventType } } errors { field message code } } }",
      variables: { input },
    });

    const { errors, webhook } = created.webhookCreate;

    if (webhook === null) {
      return yield* rejected(store, "subscribe to the events", errors);
    }

    return {
      events: webhook.asyncEvents.map((each) => each.code),
      id: webhook.id,
      targetUrl: webhook.targetUrl,
    } satisfies Listener["webhook"];
  });
