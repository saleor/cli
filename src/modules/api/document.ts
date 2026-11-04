import { Effect, Option, Schema } from "effect";
import { readFileSync } from "node:fs";
import { text } from "node:stream/consumers";
import { fail } from "../../core/errors.ts";
import { askText, isInteractive, required } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";

// What `api call` sends: a GraphQL document from --query, a file, or standard input,
// and the variables for it.

const readStdin = Effect.tryPromise({
  catch: () => fail("USAGE_ERROR", "Could not read the query from stdin."),
  try: async () => await text(process.stdin),
});

const readFile = (file: string) =>
  file === "-"
    ? readStdin
    : Effect.try({
        catch: () => fail("USAGE_ERROR", `Could not read "${file}".`),
        try: () => readFileSync(file, "utf-8"),
      });

export const documentFrom = (input: {
  readonly file: Option.Option<string>;
  readonly query: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    if (Option.isSome(input.query) && Option.isSome(input.file)) {
      return yield* fail(
        "USAGE_ERROR",
        "Pass the GraphQL document with --query or --file, not both."
      );
    }

    const text = Option.isSome(input.query)
      ? input.query.value
      : yield* Option.match(input.file, {
          onNone: () => Effect.succeed(""),
          onSome: readFile,
        });

    // Nothing given at all: a person types the document; an empty file still fails.
    if (
      text.trim() === "" &&
      Option.isNone(input.file) &&
      (yield* isInteractive)
    ) {
      const query = yield* askText({
        message: "What should be sent? A GraphQL query or mutation.",
        placeholder: "{ shop { name } }",
        validate: required("A GraphQL document"),
      });

      yield* recordAnswer({ option: ["--query", query] });

      return query;
    }

    if (text.trim() === "") {
      return yield* fail("USAGE_ERROR", "No GraphQL document to send.", {
        suggestion:
          "Pass it with --query '<graphql>', or --file <path> (--file - reads stdin).",
      });
    }

    return text;
  });

const decodeVariables = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.JsonObject)
);

export const variablesFrom = (input: Option.Option<string>) =>
  Option.match(input, {
    onNone: () => Effect.succeed(undefined),
    onSome: (raw) =>
      Option.match(decodeVariables(raw), {
        onNone: () =>
          Effect.fail(
            fail("USAGE_ERROR", "--variables must be a JSON object.", {
              suggestion: `For example: --variables '{"first": 10}'`,
            })
          ),
        onSome: (variables) => Effect.succeed(variables),
      }),
  });
