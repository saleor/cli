#!/usr/bin/env node
// Process entry: runs the CLI with this process's arguments. `bin/saleor.mjs` loads it
// from source; `pnpm build` bundles it into `dist/saleor.mjs`.
import { Effect } from "effect";
import { main } from "./main.ts";

await Effect.runPromise(main(process.argv.slice(2)));
