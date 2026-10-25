import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Effect, Predicate } from "effect";
import { type CliFailure, fail } from "./errors.ts";

const isAlive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

// Takes the lock file, or returns false while a live process holds it. A lock left by
// a dead process is moved aside with a rename before retrying: only one process can
// rename it, so two processes reclaiming the same stale lock cannot both win.
const acquire = (file: string): boolean => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });

      return true;
    } catch (error) {
      if (!(Predicate.hasProperty(error, "code") && error.code === "EEXIST")) {
        throw error;
      }
    }

    let holder: number;
    let inode: number;

    try {
      holder = Number(readFileSync(file, "utf8"));
      inode = statSync(file).ino;
    } catch {
      // Released between the two calls; try again.
      continue;
    }

    if (isAlive(holder)) {
      return false;
    }

    const stale = `${file}.stale-${randomBytes(4).toString("hex")}`;

    try {
      renameSync(file, stale);
    } catch {
      // Another process reclaimed it first; try again.
      continue;
    }

    // Between reading the dead holder and the rename, another process may have
    // reclaimed the lock and written its own. That one is put back, not discarded.
    if (statSync(stale).ino !== inode) {
      try {
        linkSync(stale, file);
      } catch {
        // A third process took the free name; the lock is held either way.
      }

      rmSync(stale, { force: true });

      return false;
    }

    rmSync(stale, { force: true });
  }

  return false;
};

// Runs `effect` while holding an exclusive per-user lock named `name` in `dir`. While
// another live process holds it, fails with BUSY instead of waiting or racing it.
export const withLock = <A, E, R>(
  dir: string,
  name: string,
  busyMessage: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CliFailure, R> =>
  Effect.acquireUseRelease(
    Effect.try({
      catch: () =>
        fail("LOCAL_STATE_ERROR", `Could not create a lock in ${dir}.`),
      try: () => {
        mkdirSync(dir, { mode: 0o700, recursive: true });
        const file = path.join(dir, `.${name}.lock`);

        return { acquired: acquire(file), file };
      },
    }).pipe(
      Effect.filterOrFail(
        (lock) => lock.acquired,
        () =>
          fail("BUSY", busyMessage, {
            suggestion:
              "Wait for that command to finish, then run this one again.",
          })
      )
    ),
    () => effect,
    (lock) => Effect.sync(() => rmSync(lock.file, { force: true }))
  );
