import { Cause, Data } from "effect";

// Process exit codes. 2 means the command line has to change before it can succeed
// (invalid or missing input); 75 means the work started and is not finished yet;
// every other failure exits 1, with the reason in `error.code`.
export const ExitCode = {
  Failure: 1,
  Interrupted: 130,
  // sysexits EX_TEMPFAIL: the work was accepted but is not finished; re-running the
  // same command continues where it left off.
  NotReady: 75,
  Success: 0,
  Usage: 2,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

interface ErrorSpec {
  readonly exitCode: ExitCode;
  readonly meaning: string;
  // Whether the same command can succeed later without changes. A failure may
  // override it when it knows better (an ambiguous write, for example).
  readonly retry: boolean;
}

const input = (meaning: string): ErrorSpec => ({
  exitCode: ExitCode.Usage,
  meaning,
  retry: false,
});

const failed = (meaning: string, retry = false): ErrorSpec => ({
  exitCode: ExitCode.Failure,
  meaning,
  retry,
});

// Every error the CLI reports, with its exit code and retry semantics. This table is
// the contract scripts and agents branch on: add codes, never rename or repurpose
// them, and pick the code by its meaning here rather than by what reads well in one
// command. `saleor commands --json` publishes it.
export const ERRORS = {
  AMBIGUOUS_TARGET: input(
    "A name matches more than one resource. Use the unique slug or key instead."
  ),
  API_ERROR: failed("Saleor Cloud returned an error.", true),
  API_VALIDATION_ERROR: failed("Saleor Cloud rejected the request."),
  AUTH_DEVICE_ACCESS_DENIED: failed("The login was denied in the browser."),
  AUTH_DEVICE_CODE_EXPIRED: failed(
    "The login link expired before it was approved.",
    true
  ),
  AUTH_INVALID: failed("The credentials were rejected."),
  AUTH_REQUIRED: failed("Not logged in. Log in or set SALEOR_CLOUD_TOKEN."),
  BUSY: failed(
    "Another operation is in progress on the target. Run the command again once it finishes.",
    true
  ),
  CANCELLED: failed("The confirmation was declined. Nothing was changed."),
  CONFIRMATION_REQUIRED: failed(
    "The action deletes data and was not confirmed. Re-run with --force to confirm."
  ),
  CONTEXT_MISSING: input(
    "A required target or value was not given and could not be asked for. Pass it explicitly."
  ),
  DOCKER_FAILED: failed("A Docker command failed."),
  DOCKER_MISSING: failed("Docker is not installed."),
  DOCKER_NOT_RUNNING: failed("The Docker engine is not responding.", true),
  DOMAIN_LABEL_TAKEN: failed("The requested domain label is taken."),
  ENVIRONMENT_LIMIT_REACHED: failed(
    "The project's plan allows no more environments."
  ),
  FORBIDDEN: failed("The account is not allowed to do this."),
  IMAGE_PULL_FAILED: failed("Docker could not download an image.", true),
  INTERNAL_ERROR: failed("A bug in the CLI. Please report it."),
  LOCAL_STATE_ERROR: failed(
    "Files the CLI keeps on this computer could not be read or written."
  ),
  NAME_CONFLICT: failed(
    "A resource with this name exists with different settings or of a different type."
  ),
  NETWORK_ERROR: failed("A server could not be reached.", true),
  NOT_FOUND: failed("A resource the command needs does not exist."),
  NOT_READY: {
    exitCode: ExitCode.NotReady,
    meaning:
      "The work started but is not finished. Run the same command again to keep waiting.",
    retry: true,
  },
  ORGANIZATION_REQUIRED: failed(
    "The account does not belong to any organization."
  ),
  PORT_IN_USE: failed("A port the local instance needs is taken."),
  PRODUCTION_DELETE_REFUSED: failed(
    "Only sandboxes can be deleted from the CLI."
  ),
  TASK_FAILED: failed("A provisioning task failed."),
  TEMPLATE_FAILED: failed(
    "A project template could not be downloaded or unpacked.",
    true
  ),
  UNAVAILABLE: failed(
    "The service cannot do this right now. Run the command again later.",
    true
  ),
  USAGE_ERROR: input(
    "The command line or one of its values is invalid. Change it and run again."
  ),
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERRORS;

// SAFETY: the keys of a literal object are exactly the members of its key type.
export const ERROR_CODES = Object.keys(ERRORS) as readonly ErrorCode[];

export const EXIT_CODE_MEANINGS: ReadonlyArray<{
  readonly code: ExitCode;
  readonly meaning: string;
}> = [
  { code: ExitCode.Success, meaning: "Success." },
  { code: ExitCode.Failure, meaning: "Failed; error.code says why." },
  {
    code: ExitCode.Usage,
    meaning: `The command line cannot run as given (${ERROR_CODES.filter(
      (code) => ERRORS[code].exitCode === ExitCode.Usage
    ).join(", ")}).`,
  },
  { code: ExitCode.NotReady, meaning: ERRORS.NOT_READY.meaning },
  { code: ExitCode.Interrupted, meaning: "Interrupted (Ctrl+C)." },
];

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly code: ErrorCode;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly retry: boolean;
  readonly details?: unknown;
}> {}

export const exitCodeFor = (failure: CliFailure): ExitCode =>
  ERRORS[failure.code].exitCode;

export const fail = (
  code: ErrorCode,
  message: string,
  options: { suggestion?: string; retry?: boolean; details?: unknown } = {}
) =>
  new CliFailure({
    code,
    message,
    ...options,
    retry: options.retry ?? ERRORS[code].retry,
  });

// Anything that is not a CliFailure is a bug in the CLI, not a user or Cloud problem.
export const internalFailure = (cause: Cause.Cause<unknown>) =>
  fail(
    "INTERNAL_ERROR",
    `Something went wrong: ${Cause.pretty(cause).split("\n")[0]}`,
    {
      suggestion:
        "This is a bug in the Saleor CLI. Please report it, with the command you ran and this message.",
    }
  );
