import { Effect, Option } from "effect";
import { defineActions, defineGroup } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { option } from "../../core/inputs.ts";
import { envInput } from "../../core/instances.ts";
import {
  connectStore,
  storeFailure,
  storeRequest,
} from "../../core/store-api.ts";
import { documentFrom, variablesFrom } from "./document.ts";

const api = defineActions();

const callCommand = api.session({
  description:
    "Send one GraphQL request to a store's API and print the data it answers with. The document comes from --query, or a file with --file (--file - reads stdin); queries and mutations are sent as given, without asking. The token is the store's (SALEOR_TOKEN, a saved one, a local instance's own, or a prompt); --anonymous sends none, for what anyone may query. An answer with GraphQL errors fails, with the errors and any partial data in error.details.",
  examples: [
    {
      command: "saleor api call local --query '{ shop { name } }'",
      description: "Query the project's local store",
    },
    {
      command:
        "saleor api call staging --file products.graphql --variables '{\"first\": 10}'",
      description: "Run a query from a file, with variables",
    },
    {
      command:
        "saleor api call cloud:acme/env1 --anonymous --query '{ channels { slug } }'",
      description: "Query without a token",
    },
  ],
  inputs: {
    anonymous: option.boolean(
      "anonymous",
      "Send no token: for what anyone may query, such as products in a channel."
    ),
    env: envInput,
    file: option.string("file", {
      description:
        "A file with the GraphQL document; - reads it from standard input.",
      metavar: "path",
    }),
    query: option.string("query", {
      description: "The GraphQL document to send.",
      metavar: "graphql",
    }),
    variables: option.string("variables", {
      description: "Variables for the document, as a JSON object.",
      metavar: "json",
    }),
  },
  name: "call",
  run: (input) =>
    Effect.gen(function* () {
      // Read the request first, so a mistake in it fails before any token prompt.
      const query = yield* documentFrom(input);
      const variables = yield* variablesFrom(input.variables);

      const { instance, token } = yield* connectStore(input.env, {
        anonymous: input.anonymous,
        needs: "the permissions the request needs",
      });

      const answer = yield* storeRequest({
        query,
        token: Option.getOrUndefined(token),
        url: instance.graphqlUrl,
        variables,
      });

      if (answer.errors.length > 0) {
        return yield* storeFailure(instance, answer);
      }

      return result(answer.data, JSON.stringify(answer.data, null, 2));
    }),
  summary: "Send a GraphQL request to a store's API.",
});

export const apiCommand = defineGroup({
  actions: [callCommand],
  description:
    "A store's own GraphQL API, with the store named as in every command: a name from saleor.yml or a store ref (cloud:<org>/<env key>, local:<name>), and its token found for you.",
  name: "api",
  summary: "Send GraphQL requests to a store.",
});
