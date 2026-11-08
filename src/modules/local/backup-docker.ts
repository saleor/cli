import { Effect } from "effect";
import path from "node:path";
import type { CliFailure } from "../../core/errors.ts";
import { withProgress } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import type { LocalConfig } from "./compose.ts";
import { Docker } from "./docker.ts";
import { untilApiAnswers } from "./lifecycle.ts";
import { composeArgs } from "./state.ts";

// The Docker steps of local backups: copying a store's database and media files out
// of its containers, and back in.

type Compose = (args: readonly string[]) => Effect.Effect<string, CliFailure>;

// Runs `docker compose` against one store.
export const composeOf = (name: string) =>
  Effect.gen(function* () {
    const docker = yield* Docker;

    return ((args) => docker.run(composeArgs(name, args))) satisfies Compose;
  });

export const dumpDatabase = (compose: Compose, partial: string) =>
  withProgress(
    "Backing up the database…",
    "Database backed up.",
    Effect.gen(function* () {
      yield* compose([
        "exec",
        "-T",
        "db",
        "pg_dump",
        "-U",
        "saleor",
        "--format",
        "custom",
        "--file",
        "/tmp/saleor-cli.dump",
        "saleor",
      ]);
      yield* compose([
        "cp",
        "db:/tmp/saleor-cli.dump",
        path.join(partial, "db.dump"),
      ]);
      yield* compose(["exec", "-T", "db", "rm", "-f", "/tmp/saleor-cli.dump"]);
    })
  );

export const packMedia = (compose: Compose, partial: string) =>
  withProgress(
    "Backing up media files…",
    "Media files backed up.",
    Effect.gen(function* () {
      yield* compose([
        "exec",
        "-T",
        "-u",
        "root",
        "api",
        "tar",
        "-czf",
        "/tmp/saleor-cli-media.tgz",
        "-C",
        "/app/media",
        ".",
      ]);
      yield* compose([
        "cp",
        "api:/tmp/saleor-cli-media.tgz",
        path.join(partial, "media.tgz"),
      ]);
      yield* compose([
        "exec",
        "-T",
        "-u",
        "root",
        "api",
        "rm",
        "-f",
        "/tmp/saleor-cli-media.tgz",
      ]);
    })
  );

// After the data is replaced, the store keeps the admin login the CLI saved for it,
// whichever store the backup came from.
const resetAdmin = `
import os
from saleor.account.models import User
user, _ = User.objects.get_or_create(email=os.environ["DJANGO_SUPERUSER_EMAIL"])
user.is_staff = True
user.is_superuser = True
user.is_active = True
user.set_password(os.environ["DJANGO_SUPERUSER_PASSWORD"])
user.save()
`;

// Stops what writes to the database, replaces it and the media files, migrates the
// restored data to the store's Saleor version, and starts everything again.
export const replaceData = (config: LocalConfig, folder: string) =>
  Effect.gen(function* () {
    const compose = yield* composeOf(config.name);

    yield* withProgress(
      "Restoring the database…",
      "Database restored.",
      Effect.gen(function* () {
        yield* compose(["stop", "api", "worker"]);
        yield* compose([
          "cp",
          path.join(folder, "db.dump"),
          "db:/tmp/saleor-cli.dump",
        ]);
        yield* compose([
          "exec",
          "-T",
          "db",
          "pg_restore",
          "-U",
          "saleor",
          "--dbname",
          "saleor",
          "--clean",
          "--if-exists",
          "--no-owner",
          "--single-transaction",
          "/tmp/saleor-cli.dump",
        ]);
        yield* compose([
          "exec",
          "-T",
          "db",
          "rm",
          "-f",
          "/tmp/saleor-cli.dump",
        ]);
      })
    );

    yield* withProgress(
      "Updating the restored data…",
      "Restored data is up to date.",
      Effect.gen(function* () {
        yield* compose([
          "run",
          "--rm",
          "-T",
          "api",
          "python",
          "manage.py",
          "migrate",
          "--noinput",
        ]);
        yield* compose([
          "run",
          "--rm",
          "-T",
          "api",
          "python",
          "manage.py",
          "shell",
          "-c",
          resetAdmin,
        ]);
      })
    );

    yield* withProgress(
      "Restoring media files…",
      "Media files restored.",
      Effect.gen(function* () {
        yield* compose(["start", "api", "worker"]);
        yield* compose([
          "cp",
          path.join(folder, "media.tgz"),
          "api:/tmp/saleor-cli-media.tgz",
        ]);
        yield* compose([
          "exec",
          "-T",
          "-u",
          "root",
          "api",
          "sh",
          "-c",
          "find /app/media -mindepth 1 -delete && tar -xzf /tmp/saleor-cli-media.tgz -C /app/media && chown -R saleor:saleor /app/media; rm -f /tmp/saleor-cli-media.tgz",
        ]);
      })
    );
  });

// Saleor answers again a few seconds after it is started; the restore is done then.
export const waitForApi = (config: LocalConfig, timeout: number) =>
  untilApiAnswers(config, deadlineIn(timeout));
