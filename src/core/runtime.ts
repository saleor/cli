import { formatWithOptions } from "node:util";
import {
  Cause,
  Console,
  Effect,
  type Layer,
  Match,
  Option,
  Predicate,
} from "effect";
import {
  CliConfig,
  CliError,
  CliOutput,
  Command,
  GlobalFlag,
} from "effect/cli";
import { renderFailure } from "./command.ts";
import { ExitCode, fail, internalFailure } from "./errors.ts";
import { helpFormatter } from "./help.ts";
import { Invocation } from "./invocation.ts";
import {
  OutputFlag,
  outputFormatFromArgv,
  resolveOutputFormat,
  useColors,
} from "./output.ts";

interface CliRuntimeOptions<Services> {
  readonly services: Layer.Layer<Services>;
  readonly version: string;
}

// Effect's parser messages, reworded to read like the rest of the CLI's errors.
// "Expected: Schema validation failed: Expected a value …" → "a value …"
const EXPECTED_PREFIX =
  /^(Expected:?\s*)?(Schema validation failed:\s*)?(Expected\s*)?/;

const describeUsageError = (error: CliError.CliError): string =>
  Match.value(error).pipe(
    Match.tag("UnrecognizedOption", (e) => `Unknown flag ${e.option}.`),
    Match.tag("MissingOption", (e) => `Missing required flag --${e.option}.`),
    Match.tag(
      "MissingArgument",
      (e) => `Missing required argument <${e.argument}>.`
    ),
    Match.tag(
      "UnexpectedArgument",
      (e) =>
        `Unexpected argument ${e.arguments.map((arg) => `"${arg}"`).join(", ")}.`
    ),
    Match.tag("InvalidValue", (e) => {
      const expected = e.expected.replace(EXPECTED_PREFIX, "");

      const name = e.kind === "flag" ? `--${e.option}` : `<${e.option}>`;

      return e.value.length === 0
        ? `${name} needs a value.`
        : `Invalid value "${e.value}" for ${name}: expected ${expected}.`;
    }),
    Match.tag(
      "UnknownSubcommand",
      (e) =>
        `Unknown command "${[...(e.parent ?? []), e.subcommand].join(" ")}".`
    ),
    Match.orElse((e) => e.message)
  );

const suggestionsOf = (error: CliError.CliError): readonly string[] =>
  Predicate.isTagged(error, "UnrecognizedOption") ||
  Predicate.isTagged(error, "UnknownSubcommand")
    ? error.suggestions
    : [];

const usageFailure = (error: CliError.CliError) => {
  const reasons = Predicate.isTagged(error, "ShowHelp")
    ? error.errors
    : [error];

  const commandPath = Predicate.isTagged(error, "ShowHelp")
    ? error.commandPath
    : ["saleor"];

  const [first = error] = reasons;
  const didYouMean = suggestionsOf(first);

  return fail("USAGE_ERROR", describeUsageError(first), {
    details:
      reasons.length > 1
        ? { errors: reasons.map(describeUsageError) }
        : undefined,
    suggestion:
      didYouMean.length > 0
        ? `Did you mean: ${[...commandPath, didYouMean[0]].join(" ")}\nSee all options with: ${commandPath.join(" ")} --help`
        : `See the usage with: ${commandPath.join(" ")} --help`,
  });
};

// --wizard asks about every flag with Effect's fixed wording ("Set No browser?") and
// --log-level has nothing to show because the CLI does not log. Commands that need
// input prompt for it themselves.
const builtIns = [
  GlobalFlag.Help,
  GlobalFlag.Version,
  GlobalFlag.Completions,
] as const;

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

    // Effect writes help and the version through Console.log; nothing else does. It is
    // held back until the command finishes so a usage error can drop the help page and
    // print one error instead, and in json mode it goes to stderr so stdout carries one
    // result document only.
    const parserOutput: string[] = [];
    let showParserOutput = true;

    const parserConsole = {
      ...globalThis.console,
      log: (...args: unknown[]) => {
        parserOutput.push(formatWithOptions({ colors: false }, ...args));
      },
    };

    const flushParserOutput = Effect.sync(() => {
      if (showParserOutput && parserOutput.length > 0) {
        const stream = format === "json" ? process.stderr : process.stdout;
        stream.write(`${parserOutput.join("\n")}\n`);
      }
    });

    // SAFETY: Command.Any erases module requirements. defineModule checks at compile time that each module's layer builds what its commands need, and the composition root merges those layers into `services`.
    return Command.runWith(command, {
      renderErrors: false,
      version: options.version,
    })(argv).pipe(
      Effect.catchIf(CliError.isCliError, (error) => {
        if (
          Predicate.isTagged(error, "ShowHelp") &&
          error.errors.length === 0
        ) {
          return Effect.void;
        }

        showParserOutput = false;

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
      Effect.ensuring(flushParserOutput),
      Effect.provideService(Console.Console, parserConsole),
      Effect.provideService(
        CliOutput.Formatter,
        helpFormatter(format === "text" && useColors())
      ),
      Effect.provideService(Invocation, rawArgv),
      Effect.provideService(CliConfig.CliConfig, CliConfig.make({ builtIns })),
      Effect.provide(options.services)
    ) as Effect.Effect<void>;
  };
