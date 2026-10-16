import { Cause, Data } from "effect";

// Process exit codes. Everything that is not success, "not finished yet" or an
// interruption exits 1; the reason is carried by `error.code` in the output.
export const ExitCode = {
  Failure: 1,
  Interrupted: 130,
  // sysexits EX_TEMPFAIL: the work was accepted but is not finished; re-running the
  // same command continues where it left off.
  NotReady: 75,
  Success: 0,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

// Machine-stable error codes, CATEGORY_SPECIFIC_ISSUE. Add codes; never rename them.
export type ErrorCode =
  | "USAGE_ERROR"
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "AUTH_DEVICE_CODE_EXPIRED"
  | "AUTH_DEVICE_ACCESS_DENIED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONTEXT_MISSING"
  | "ORGANIZATION_REQUIRED"
  | "NAME_CONFLICT"
  | "DOMAIN_LABEL_TAKEN"
  | "ENVIRONMENT_LIMIT_REACHED"
  | "PAID_PLAN_NOT_CONFIRMED"
  | "CONFIRMATION_REQUIRED"
  | "PRODUCTION_DELETE_REFUSED"
  | "PROJECT_NOT_EMPTY"
  | "NOT_READY"
  | "TASK_FAILED"
  | "API_VALIDATION_ERROR"
  | "API_ERROR"
  | "NETWORK_ERROR"
  | "INTERNAL_ERROR";

export class CliFailure extends Data.TaggedError("CliFailure")<{
  readonly code: ErrorCode;
  readonly message: string;
  readonly suggestion?: string | undefined;
  readonly retry?: boolean | undefined;
  readonly details?: unknown;
}> {}

export const exitCodeFor = (failure: CliFailure): ExitCode =>
  failure.code === "NOT_READY" ? ExitCode.NotReady : ExitCode.Failure;

export const fail = (
  code: ErrorCode,
  message: string,
  options: { suggestion?: string; retry?: boolean; details?: unknown } = {}
) => new CliFailure({ code, message, ...options });

// Anything that is not a CliFailure is a bug in the CLI, not a user or Cloud problem.
export const internalFailure = (cause: Cause.Cause<unknown>) =>
  fail(
    "INTERNAL_ERROR",
    `Unexpected error: ${Cause.pretty(cause).split("\n")[0]}`,
    {
      suggestion:
        "Re-run with --log-level debug and report the output if this persists.",
    }
  );
