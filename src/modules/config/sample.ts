import { Effect } from "effect";
import { recordDeploy } from "../../core/deploy-record.ts";
import { fail } from "../../core/errors.ts";
import { command } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import type { SetupResult } from "../../core/setup.ts";
import { connectTo } from "../../core/store-api.ts";
import { sourceFor } from "../../core/stores.ts";
import { pull, shown } from "./engine.ts";
import { reviewText, writeConfig } from "./file-output.ts";

export const prepareSampleData = (made: SetupResult) =>
  Effect.gen(function* () {
    if (!made.sampleDataReady) {
      const source = yield* sourceFor(made.ref);

      if (source.populate === undefined) {
        return yield* fail(
          "UNAVAILABLE",
          `${made.ref} cannot load Saleor's sample data from the CLI.`
        );
      }

      yield* notice("Loading Saleor's sample data…");
      yield* source.populate(made);
    }
  });

// Exporting sample configuration is optional; Cloud sample data needs no store token.
export const sampleConfiguration = (
  made: SetupResult,
  file: string,
  save: boolean
) =>
  Effect.gen(function* () {
    yield* prepareSampleData(made);

    if (!save) {
      return {
        config: null,
        lines: [
          `✓ Saleor's sample data is ready in ${made.ref}.`,
          `Skipped saving the store configuration locally. Pull it later with: ${command("config", "pull", made.ref)}`,
        ],
      };
    }

    const config = yield* pull(yield* connectTo(made));
    yield* writeConfig(file, config);
    yield* recordDeploy(file, made.ref);

    return {
      config: file,
      lines: [
        `✓ Saved the sample configuration in ${shown(file)}.`,
        ...reviewText(config),
      ],
    };
  });
