import { Effect, Option, Schema } from "effect";
import os from "node:os";
import { fail } from "./errors.ts";
import type { Store } from "./store.ts";
import { notice } from "./output.ts";
import { SecretStore } from "./secret-store.ts";
import { storeRequest } from "./store-api.ts";
import { storeTokenKey } from "./store-token.ts";

// A lasting token for a store's own API, made with a login that may manage its apps.
// The CLI makes an app named "Saleor CLI" on the store with every permission the login
// has, or reuses that app, and saves the app's token for the store, so this runs once
// per store on each computer. App tokens do not expire, unlike the logins that make
// them: a Cloud login (modules/cloud/store-access.ts) or a local store's admin sign-in
// (modules/local/access.ts), which lasts minutes.

export const APP_NAME = "Saleor CLI";

const Codes = Schema.Array(Schema.Struct({ code: Schema.String }));

const MutationErrors = Schema.Array(
  Schema.Struct({ message: Schema.NullOr(Schema.String) })
);

const Requester = Schema.Struct({
  apps: Schema.NullOr(
    Schema.Struct({
      edges: Schema.Array(
        Schema.Struct({
          node: Schema.Struct({ id: Schema.String, name: Schema.String }),
        })
      ),
    })
  ),
  me: Schema.NullOr(Schema.Struct({ userPermissions: Codes })),
});

const Issued = Schema.Struct({
  authToken: Schema.NullOr(Schema.String),
  errors: MutationErrors,
});

// Both mutations answer under the alias `issued`.
const Issuing = Schema.Struct({ issued: Issued });

const REQUESTER = `query($name: String!) {
  me { userPermissions { code } }
  apps(first: 100, filter: { search: $name }) { edges { node { id name } } }
}`;

const APP_CREATE = `mutation($name: String!, $permissions: [PermissionEnum!]) {
  issued: appCreate(input: { name: $name, permissions: $permissions }) { authToken errors { message } }
}`;

const APP_TOKEN_CREATE = `mutation($app: ID!, $name: String!) {
  issued: appTokenCreate(input: { app: $app, name: $name }) { authToken errors { message } }
}`;

export interface Login {
  // How the login goes to the store: a header and its value.
  readonly headers: Record<string, string>;
  // The login, as messages name it mid-sentence: "your Saleor Cloud login".
  readonly label: string;
  // What happens without the app's token, ending the message that says so.
  readonly otherwise: string;
}

// None when the store does not let the login make the app; it says why first.
export const cliAppToken = (instance: Store, login: Login) =>
  Effect.gen(function* () {
    const ask = <S extends Schema.Top>(
      schema: S,
      query: string,
      variables: Schema.JsonObject
    ) =>
      storeRequest({
        headers: login.headers,
        query,
        url: instance.graphqlUrl,
        variables,
      }).pipe(
        Effect.flatMap((answer) =>
          answer.errors.length > 0
            ? Effect.succeed(Option.none<S["Type"]>())
            : Schema.decodeUnknownEffect(schema)(answer.data).pipe(
                Effect.asSome,
                Effect.mapError(() =>
                  fail(
                    "STORE_ERROR",
                    `${instance.ref} answered in a shape this CLI does not know.`
                  )
                )
              )
        )
      );

    const requester = yield* ask(Requester, REQUESTER, { name: APP_NAME });

    // The store did not take the login, or it may not manage apps.
    if (
      Option.isNone(requester) ||
      requester.value.me === null ||
      requester.value.apps === null
    ) {
      yield* notice(
        `${login.label.charAt(0).toUpperCase()}${login.label.slice(1)} cannot create an app on ${instance.ref}, so ${login.otherwise}.`
      );

      return Option.none<string>();
    }

    const existing = requester.value.apps.edges.find(
      (edge) => edge.node.name === APP_NAME
    );

    const answer =
      existing === undefined
        ? yield* ask(Issuing, APP_CREATE, {
            name: APP_NAME,
            permissions: requester.value.me.userPermissions.map(
              (each) => each.code
            ),
          })
        : yield* ask(Issuing, APP_TOKEN_CREATE, {
            app: existing.node.id,
            name: os.hostname(),
          });

    const issued = Option.map(answer, (data) => data.issued);

    if (Option.isNone(issued) || issued.value.authToken === null) {
      const reasons = Option.match(issued, {
        onNone: () => "the store refused the request",
        onSome: (value) =>
          value.errors.map((error) => error.message ?? "").join("; "),
      });

      yield* notice(
        `Could not make a token for ${instance.ref} with ${login.label} (${reasons}), so ${login.otherwise}.`
      );

      return Option.none<string>();
    }

    const token = issued.value.authToken;
    yield* (yield* SecretStore).set(storeTokenKey(instance.ref), token);
    yield* notice(
      existing === undefined
        ? `Created the app "${APP_NAME}" on ${instance.ref} and saved its token on this computer.`
        : `Made a token for the app "${APP_NAME}" on ${instance.ref} and saved it on this computer.`
    );

    return Option.some(token);
  });
