import { Schema } from "effect";
import { Flag } from "effect/cli";

export const timeoutFlag = Flag.Int("timeout").pipe(
  Flag.withSchema(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  Flag.withMetavar("seconds"),
  Flag.withDescription(
    "How long to wait (default 600). Setup continues after that; run the same command again to keep waiting (exit code 75 until then)."
  ),
  Flag.withDefault(600)
);

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Skip the confirmation question. Required when not running in a terminal."
  ),
  Flag.withDefault(false)
);
