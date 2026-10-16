import { Cause, Console, Effect, type Layer, Option, Predicate } from "effect";
import { CliError, Command } from "effect/cli";
import { renderFailure } from "./command.ts";
import { ExitCode, fail, internalFailure } from "./errors.ts";
import { Invocation } from "./invocation.ts";
import {
  OutputFlag,
  outputFormatFromArgv,
  resolveOutputFormat,
} from "./output.ts";

interface CliRuntimeOptions<Services> {
  readonly services: Layer.Layer<Services>;
  readonly version: string;
}

const usageFailure = (error: CliError.CliError) => {
  const reasons = Predicate.isTagged(error, "ShowHelp")
    ? error.errors
    : [error];

  const [first] = reasons;

  return fail("USAGE_ERROR", first?.message ?? error.message, {
    details:
      reasons.length > 1
        ? { errors: reasons.map((r) => r.message) }
        : undefined,
    suggestion:
      "Run the command with --help, or `saleor commands --output json` for the full catalogue.",
  });
};

// Owns the process-facing CLI policy: argument aliases, output routing, parser
// failures, interruption handling and the boundary around erased command types.
export const createCliRuntime =
  <Services>(
    command: Command.Command.Any,
    options: CliRuntimeOptions<Services>
  ) =>
  (rawArgv: readonly string[]): Effect.Effect<void> => {
    const argv = rawArgv.flatMap((arg) =>
      arg === "--json" ? ["--output", "json"] : [arg]
    );

    const format = resolveOutputFormat(outputFormatFromArgv(argv));

    // In json mode stdout carries one result document only; help and other incidental
    // console output from the parser is sent to stderr.
    const consoleForFormat =
      format === "json"
        ? {
            ...globalThis.console,
            log: (...args: unknown[]) => globalThis.console.error(...args),
          }
        : globalThis.console;

    // SAFETY: Command.Any erases module requirements. defineModule checks at compile time that each module's layer builds what its commands need, and the composition root merges those layers into `services`.
    return Command.runWith(command, {
      renderErrors: format === "text",
      version: options.version,
    })(argv).pipe(
      Effect.catchIf(CliError.isCliError, (error) => {
        if (
          Predicate.isTagged(error, "ShowHelp") &&
          error.errors.length === 0
        ) {
          return Effect.void;
        }

        if (format === "text") {
          return Effect.sync(() => {
            process.exitCode = ExitCode.Failure;
          });
        }

        return renderFailure(usageFailure(error)).pipe(
          Effect.provideService(OutputFlag, Option.some(format))
        );
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.sync(() => {
              process.exitCode = ExitCode.Interrupted;
            })
          : renderFailure(internalFailure(cause)).pipe(
              Effect.provideService(OutputFlag, Option.some(format))
            )
      ),
      Effect.provideService(Console.Console, consoleForFormat),
      Effect.provideService(Invocation, rawArgv),
      Effect.provide(options.services)
    ) as Effect.Effect<void>;
  };
