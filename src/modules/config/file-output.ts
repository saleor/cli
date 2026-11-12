import { Effect } from "effect";
import { writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { fail } from "../../core/errors.ts";
import { review } from "./describe.ts";
import type { Document } from "./document.ts";

export const writeConfig = (file: string, config: Document) =>
  Effect.try({
    catch: () => fail("LOCAL_STATE_ERROR", `Could not write ${file}.`),
    try: () => {
      writeFileSync(file, stringify(config));
    },
  });

export const reviewText = (config: Document) =>
  review(config).map(([label, value]) => `  ${label}: ${value}`);
