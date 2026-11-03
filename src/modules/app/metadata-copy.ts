import { Effect } from "effect";
import { askConfirm, isInteractive } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";
import type { StoreClient } from "../../core/store-api.ts";
import { metadataOf } from "./store.ts";

// Whether `app reinstall` copies the old app's metadata to the new install: when
// --copy-metadata says so, or, in a terminal, when the person agrees. Apps often keep
// their settings there, and the delete loses them.
export const metadataToCopy = (
  client: StoreClient,
  id: string,
  flag: boolean
) =>
  Effect.gen(function* () {
    const metadata = yield* metadataOf(client, id);
    const keys = metadata.metadata.length + metadata.privateMetadata.length;
    const asked = !flag && keys > 0 && (yield* isInteractive);

    const copying =
      keys > 0 &&
      (flag ||
        (asked &&
          (yield* askConfirm(
            `Copy the app's metadata (${keys} ${keys === 1 ? "key" : "keys"}) to the new install? Apps often keep their settings there.`,
            true
          ))));

    if (asked && copying) {
      yield* recordAnswer({ flag: "--copy-metadata" });
    }

    return { copying, keys, metadata };
  });
