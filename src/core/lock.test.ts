import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it } from "vitest";
import { withLock } from "./lock.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "saleor-lock-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const locked = <A, E>(effect: Effect.Effect<A, E>) =>
  withLock(dir, "demo", "Busy.", effect);

it("refuses while a live process holds the lock, and releases it afterwards", async () => {
  const inner = await Effect.runPromise(
    locked(Effect.flip(locked(Effect.succeed("never"))))
  );

  expect(inner.code).toBe("BUSY");
  expect(inner.retry).toBe(true);
  expect(existsSync(path.join(dir, ".demo.lock"))).toBe(false);
});

it("reclaims a lock left by a process that is gone", async () => {
  // PIDs are positive; 2^31-1 is far above any live one on test machines.
  writeFileSync(path.join(dir, ".demo.lock"), "2147483647");

  expect(await Effect.runPromise(locked(Effect.succeed("ran")))).toBe("ran");
});
