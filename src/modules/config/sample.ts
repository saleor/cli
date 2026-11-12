import { Effect } from "effect";
import { recordDeploy } from "../../core/deploy-record.ts";
import { fail } from "../../core/errors.ts";
import { command } from "../../core/invocation.ts";
import { notice, shown } from "../../core/output.ts";
import type { Brief, SetupResult } from "../../core/setup.ts";
import { connectTo } from "../../core/store-api.ts";
import { sourceFor } from "../../core/stores.ts";
import { pull } from "./engine.ts";
import { writeConfig } from "./file-output.ts";

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
        brief: {
          next: [
            `To keep its configuration: ${command("config", "pull", made.ref)}`,
          ],
          rows: [["Configuration", "Saleor's sample data (not saved)"]],
        } satisfies Brief,
        config: null,
      };
    }

    const config = yield* pull(yield* connectTo(made));
    yield* writeConfig(file, config);
    yield* recordDeploy(file, made.ref);

    return {
      brief: {
        rows: [["Configuration", `${shown(file)} (Saleor's sample data)`]],
      } satisfies Brief,
      config: file,
    };
  });
