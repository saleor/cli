import { Schema } from "effect";
import { Flag } from "effect/cli";

export const timeoutFlag = Flag.Int("timeout").pipe(
  Flag.withSchema(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  Flag.withDescription(
    "Seconds to wait before returning NOT_READY (exit 75). Re-running continues the wait."
  ),
  Flag.withDefault(600)
);

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Confirm a destructive action without being asked. Required when there is no terminal."
  ),
  Flag.withDefault(false)
);
