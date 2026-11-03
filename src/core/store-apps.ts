import { Effect, Schema } from "effect";
import {
  mutationRejected,
  MutationErrors,
  PermissionCodes,
  type StoreClient,
  storeData,
} from "./store-api.ts";

// Saleor apps on a store, as more than one module manages them: `app` installs and
// removes them, `webhook listen` makes a temporary one, and the CLI makes its own
// (cli-app.ts).

const Requester = Schema.Struct({
  me: Schema.NullOr(Schema.Struct({ userPermissions: PermissionCodes })),
});

const RequestingApp = Schema.Struct({
  app: Schema.NullOr(Schema.Struct({ permissions: PermissionCodes })),
});

const Deleted = Schema.Struct({
  appDelete: Schema.Struct({ errors: MutationErrors }),
});

// What the token may grant an app: a staff member's permissions, or an app's own.
// Saleor only lets a token grant permissions its owner has.
export const grantablePermissions = (client: StoreClient) =>
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

// Deletes the app with its webhooks and settings.
export const deleteApp = (client: StoreClient, id: string) =>
  Effect.gen(function* () {
    const { appDelete } = yield* storeData(client, Deleted, {
      query:
        "mutation($id: ID!) { appDelete(id: $id) { errors { field message } } }",
      variables: { id },
    });

    if (appDelete.errors.length > 0) {
      return yield* mutationRejected(
        client.store,
        "delete the app",
        appDelete.errors
      );
    }
  });
