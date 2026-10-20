import { Cause, Data } from "effect";

// Process exit codes. A command line the CLI cannot run exits 2, like most CLIs;
// everything else that is not success, "not finished yet" or an interruption exits 1,
// with the reason in `error.code`.
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

// Machine-stable error codes, CATEGORY_SPECIFIC_ISSUE. Add codes; never rename them.
// Listed at runtime too, so `saleor commands --json` can publish them.
export const ERROR_CODES = [
  "USAGE_ERROR",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "AUTH_DEVICE_CODE_EXPIRED",
  "AUTH_DEVICE_ACCESS_DENIED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONTEXT_MISSING",
  "ORGANIZATION_REQUIRED",
  "NAME_CONFLICT",
  "DOMAIN_LABEL_TAKEN",
  "ENVIRONMENT_LIMIT_REACHED",
  "PAID_PLAN_NOT_CONFIRMED",
  "CONFIRMATION_REQUIRED",
  "CANCELLED",
  "PRODUCTION_DELETE_REFUSED",
  "PROJECT_NOT_EMPTY",
  "NOT_READY",
  "TASK_FAILED",
  "API_VALIDATION_ERROR",
  "API_ERROR",
  "NETWORK_ERROR",
  "DOCKER_MISSING",
  "DOCKER_NOT_RUNNING",
  "PORT_IN_USE",
  "IMAGE_PULL_FAILED",
  "TARGET_CREDENTIALS_REQUIRED",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

// What each exit code means, for `saleor commands --json` and the README.
export const EXIT_CODE_MEANINGS: ReadonlyArray<{
  readonly code: ExitCode;
  readonly meaning: string;
}> = [
  { code: ExitCode.Success, meaning: "Success." },
  { code: ExitCode.Failure, meaning: "Failed; error.code says why." },
  {
    code: ExitCode.Usage,
    meaning: "The command line cannot be run (USAGE_ERROR).",
  },
  {
    code: ExitCode.NotReady,
    meaning:
      "Started but not finished (NOT_READY); run the same command again to keep waiting.",
  },
  { code: ExitCode.Interrupted, meaning: "Interrupted (Ctrl+C)." },
];

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly code: ErrorCode;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly retry?: boolean | undefined;
  readonly details?: unknown;
}> {}

export const exitCodeFor = (failure: CliFailure): ExitCode => {
  switch (failure.code) {
    case "NOT_READY":
      return ExitCode.NotReady;
    case "USAGE_ERROR":
      return ExitCode.Usage;
    default:
      return ExitCode.Failure;
  }
};

export const fail = (
  code: ErrorCode,
  message: string,
  options: { suggestion?: string; retry?: boolean; details?: unknown } = {}
) => new CliFailure({ code, message, ...options });

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
