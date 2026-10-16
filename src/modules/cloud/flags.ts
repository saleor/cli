import { Schema } from "effect";
import { Flag } from "effect/cli";

export const timeoutFlag = Flag.Int("timeout").pipe(
  Flag.withSchema(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  Flag.withMetavar("seconds"),
  Flag.withDescription(
    "How long to wait (default 600). The work continues in Saleor Cloud after that; run the same command again to keep waiting (exit code 75 until then)."
  ),
  Flag.withDefault(600)
);

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Skip the confirmation question. Required when not running in a terminal."
  ),
  Flag.withDefault(false)
);

export const domainLabelDescription =
  "Subdomain for the environment (<label>.saleor.cloud). Without it, Saleor Cloud picks one and can hand out an already-running environment, which is much faster.";

export const regionDescription =
  'Region for a new project. Defaults to "us-east-1".';
