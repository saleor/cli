import { Effect, Option, Schema } from "effect";
import { fail } from "../../core/errors.ts";
import { storeRequest } from "../../core/store-api.ts";
import type { Store } from "../../core/store.ts";
import { adminEmail, savedAdminPassword } from "./state.ts";

const TokenCreate = Schema.Struct({
  tokenCreate: Schema.Struct({
    errors: Schema.Array(Schema.Struct({ message: Schema.String })),
    token: Schema.NullOr(Schema.String),
  }),
});

const TOKEN_CREATE =
  "mutation($email: String!, $password: String!) { tokenCreate(email: $email, password: $password) { token errors { message } } }";

// A staff token for the admin the CLI created, so commands that need the store's own
// API work on local stores without asking. It is made again for each command: it
// lasts 5 minutes, and an app token would not do instead, since installing and
// creating apps takes a staff user (appInstall, appCreate). None for a store
// without a saved password.
export const localStaffToken = (store: Store) =>
  Effect.gen(function* () {
    const password = yield* savedAdminPassword(store.name);

    if (Option.isNone(password)) {
      return Option.none<string>();
    }

    const failed = (reason: string) =>
      fail(
        "STORE_AUTH_INVALID",
        `Could not log in to ${store.ref} as ${adminEmail}: ${reason}`,
        {
          suggestion:
            "Set SALEOR_TOKEN to a token for this store, or recreate the store.",
        }
      );

    const data = yield* storeRequest({
      query: TOKEN_CREATE,
      url: store.graphqlUrl,
      variables: { email: adminEmail, password: password.value },
    }).pipe(
      Effect.flatMap((answer) =>
        Schema.decodeUnknownEffect(TokenCreate)(answer.data)
      ),
      Effect.mapError(() => failed("the store did not answer as expected."))
    );

    const { errors, token } = data.tokenCreate;

    if (token === null) {
      return yield* failed(errors.map((error) => error.message).join("; "));
    }

    return Option.some(token);
  });
