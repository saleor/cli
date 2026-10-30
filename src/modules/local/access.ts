import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { fail } from "../../core/errors.ts";
import type { Instance } from "../../core/instance.ts";
import { adminEmail, savedAdminPassword } from "./state.ts";

const TokenCreate = Schema.Struct({
  data: Schema.Struct({
    tokenCreate: Schema.Struct({
      errors: Schema.Array(Schema.Struct({ message: Schema.String })),
      token: Schema.NullOr(Schema.String),
    }),
  }),
});

// A staff token for the admin the CLI created, so commands that need the store's own
// API work on local instances without asking. None for an instance without a saved
// password.
export const localAccess = (instance: Instance) =>
  Effect.gen(function* () {
    const password = yield* savedAdminPassword(instance.name);

    if (Option.isNone(password)) {
      return Option.none<string>();
    }

    const failed = (reason: string) =>
      fail(
        "STORE_AUTH_INVALID",
        `Could not sign in to ${instance.ref} as ${adminEmail}: ${reason}`,
        {
          suggestion:
            "Set SALEOR_TOKEN to a token for this store, or recreate the instance.",
        }
      );

    const http = yield* HttpClient.HttpClient;

    const body = yield* http
      .execute(
        HttpClientRequest.post(instance.graphqlUrl).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            query:
              "mutation($email: String!, $password: String!) { tokenCreate(email: $email, password: $password) { token errors { message } } }",
            variables: { email: adminEmail, password: password.value },
          })
        )
      )
      .pipe(
        Effect.flatMap((response) => response.json),
        Effect.flatMap(Schema.decodeUnknownEffect(TokenCreate)),
        Effect.mapError(() => failed("the store did not answer as expected."))
      );

    const { errors, token } = body.data.tokenCreate;

    if (token === null) {
      return yield* failed(errors.map((error) => error.message).join("; "));
    }

    return Option.some(token);
  });
