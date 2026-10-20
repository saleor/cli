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
  setProgressFormat,
  useColors,
  writeJson,
} from "./output.ts";

interface CliRuntimeOptions<Services> {
  readonly services: Layer.Layer<Services>;
  readonly version: string;
}

// Effect's parser messages, reworded to read like the rest of the CLI's errors.
// "Expected: Schema validation failed: Expected a value …" → "a value …"
const NUMBER_EXPECTATION = /a string representing an? (finite number|integer)/;

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

      const readable = expected.replace(NUMBER_EXPECTATION, "a whole number");

      return e.value.length === 0
        ? `${name} needs a value.`
        : `Invalid value "${e.value}" for ${name}: expected ${readable}.`;
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

// `saleor help env create` is `saleor env create --help`; `--json` is `--output json`.
// When the output format is given more than once, the last one wins, as with any flag.
const normalizeArgv = (rawArgv: readonly string[]) => {
  const words =
    rawArgv[0] === "help" ? [...rawArgv.slice(1), "--help"] : [...rawArgv];

  const expanded = words.flatMap((arg) =>
    arg === "--json" ? ["--output", "json"] : [arg]
  );

  let last = -1;

  for (const [i, arg] of expanded.entries()) {
    if (arg === "--output" || arg.startsWith("--output=")) {
      last = i;
    }
  }

  return expanded.filter((arg, i) => {
    if (i === last || i === last + 1) {
      return true;
    }

    if (arg === "--output" || arg.startsWith("--output=")) {
      return false;
    }

    return expanded[i - 1] !== "--output";
  });
};

// --wizard asks about every flag with Effect's fixed wording ("Set No browser?") and
// --log-level has nothing to show because the CLI does not log. Commands that need
// input prompt for it themselves.
export const builtIns = [
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
    const argv = normalizeArgv(rawArgv);

    const explicitFormat = outputFormatFromArgv(argv);
    const format = resolveOutputFormat(explicitFormat);
    setProgressFormat(format);

    // `--version --json` answers like every other command in json mode. Without an
    // explicit --json the plain line stays, so `$(saleor --version)` keeps working.
    if (
      Option.contains(explicitFormat, "json") &&
      argv.some((arg) => arg === "--version" || arg === "-v") &&
      !argv.some((arg) => arg === "--help" || arg === "-h")
    ) {
      return writeJson({ data: { version: options.version }, ok: true });
    }

    // Effect writes help and the version through Console.log; nothing else does. It is
    // held back until the command finishes so a usage error can drop the help page and
    // print one error instead. Asked-for help and the version are the result of the
    // command, so they go to stdout like any other result.
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
        process.stdout.write(`${parserOutput.join("\n")}\n`);
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
