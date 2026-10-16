import { Cause, Effect, Option } from "effect";
import {
  type CliFailure,
  ExitCode,
  exitCodeFor,
  internalFailure,
} from "./errors.ts";
import {
  currentOutputFormat,
  failureEnvelope,
  successEnvelope,
  writeJson,
  writeText,
  writeTextFailure,
} from "./output.ts";

// What a handler returns: the data agents get in `data`, and the text humans see.
export interface CommandResult<A> {
  readonly data: A;
  readonly text: string;
}

export const result = <A>(data: A, text: string): CommandResult<A> => ({
  data,
  text,
});

export const renderFailure = (failure: CliFailure) =>
  Effect.gen(function* () {
    const format = yield* currentOutputFormat;

    if (format === "json") {
      yield* writeJson(failureEnvelope(failure));
    } else {
      yield* writeTextFailure(failure);
    }

    process.exitCode = exitCodeFor(failure);
  });

// Every command handler goes through here: handlers return typed data and never print
// their result or exit; this renders the one result document and sets the exit code.
export const run = <A, R>(
  handler: Effect.Effect<CommandResult<A>, CliFailure, R>
) =>
  handler.pipe(
    Effect.matchCauseEffect({
      onFailure: (cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.sync(() => {
            process.exitCode = ExitCode.Interrupted;
          });
        }

        const failure = Cause.findErrorOption(cause);

        return renderFailure(
          Option.isSome(failure) ? failure.value : internalFailure(cause)
        );
      },
      onSuccess: (outcome) =>
        Effect.gen(function* () {
          const format = yield* currentOutputFormat;

          if (format === "json") {
            yield* writeJson(successEnvelope(outcome.data));
          } else {
            yield* writeText(outcome.text);
          }

          process.exitCode = ExitCode.Success;
        }),
    })
  );
