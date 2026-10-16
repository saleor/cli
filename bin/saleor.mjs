#!/usr/bin/env node
// PoC entry: runs the TypeScript sources directly (Node >= 22.18 strips types natively).
// A bundled build replaces this before anything is published.
import { Effect } from "effect";
import { main } from "../src/main.ts";

await Effect.runPromise(main(process.argv.slice(2)));
