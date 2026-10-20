import { Schema } from "effect";
import { Flag } from "effect/cli";
import { catalogInfo } from "./input-info.ts";

catalogInfo.flag("timeout", { default: 600 });

// `--timeout` bounds how long a command waits for work it started; the work itself
// carries on. Each command says what it waits for.
export const waitFlag = (description: string) =>
  Flag.Int("timeout").pipe(
    Flag.withSchema(
      Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
    ),
    Flag.withMetavar("seconds"),
    Flag.withDescription(description),
    Flag.withDefault(600)
  );

export const timeoutFlag = waitFlag(
  "How long to wait until it is ready (default 600; 0 checks once). Setup continues after that; run the same command again to keep waiting (exit code 75 until then)."
);

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Skip the confirmation question. Required when not running in a terminal."
  ),
  Flag.withDefault(false)
);

export const dryRunFlag = Flag.Boolean("dry-run").pipe(
  Flag.withDescription(
    "Preview the resolved action as JSON without changing anything or asking for confirmation."
  ),
  Flag.withDefault(false)
);
