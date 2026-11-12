import { Effect, Option, Schema } from "effect";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Ensured, Planned } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { envWord } from "../../core/env-word.ts";
import { localRef } from "../../core/ref.ts";
import { command } from "../../core/invocation.ts";
import { configDir } from "../../core/secret-store.ts";
import type {
  Backup,
  BackupAdded,
  BackupSource,
  Restored,
} from "../../core/store.ts";
import type { LocalConfig } from "./compose.ts";
import {
  containersOf,
  isRunning,
  localStore,
  localTarget,
  withInstanceLock,
} from "./lifecycle.ts";
import {
  composeOf,
  dumpDatabase,
  packMedia,
  replaceData,
  waitForApi,
} from "./backup-docker.ts";
import { localName, readConfig, startCommand } from "./state.ts";

// Backups of local stores, kept on this computer next to the CLI's other files, so
// they outlive the store they were made from (`env remove` deletes the store's own
// folder). A backup is a folder: the database as a pg_dump archive, the media files as
// a tarball, and backup.json, written last, so a folder without it is unfinished.
//
// A backup's id is `<store>/<name>`. Any backup can be restored into any local store
// whose Saleor version is the same or newer; Saleor's migrations then bring it up.

const backupsDir = () => path.join(configDir(), "backups", "local");

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const Manifest = Schema.Struct({
  createdAt: Schema.String,
  name: Schema.String,
  saleorVersion: Schema.String,
  store: Schema.String,
});

type Manifest = typeof Manifest.Type;

const backupOf = (manifest: Manifest): Backup => ({
  createdAt: manifest.createdAt,
  environment: manifest.store,
  id: `${manifest.store}/${manifest.name}`,
  name: manifest.name,
  saleorVersion: manifest.saleorVersion,
  type: "manual",
});

const folderOf = (backup: Backup) => path.join(backupsDir(), backup.id);

const subdirectories = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
    : [];

const readManifest = (dir: string) => {
  const file = path.join(dir, "backup.json");

  if (!existsSync(file)) {
    return Option.none<Manifest>();
  }

  try {
    return Option.some(
      Schema.decodeUnknownSync(Manifest)(
        JSON.parse(readFileSync(file, "utf-8"))
      )
    );
  } catch {
    return Option.none<Manifest>();
  }
};

// Every finished local backup, newest first.
const all = Effect.sync(() =>
  subdirectories(backupsDir())
    .flatMap((store) =>
      subdirectories(path.join(backupsDir(), store)).flatMap((name) =>
        Option.toArray(readManifest(path.join(backupsDir(), store, name)))
      )
    )
    .map(backupOf)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
);

// The store's saved configuration, which must exist.
const configOf = (name: string) =>
  Effect.gen(function* () {
    yield* localName(name);
    const config = yield* readConfig(name);

    if (config === undefined) {
      return yield* fail(
        "NOT_FOUND",
        `There is no local store named ${name}.`,
        { suggestion: `See every store with: ${command("env", "list")}` }
      );
    }

    return config;
  });

// Copying data in or out needs the database and the API running.
const requireRunning = (config: LocalConfig) =>
  Effect.gen(function* () {
    const containers = yield* containersOf(config.name);

    if (!isRunning(containers, "db") || !isRunning(containers, "api")) {
      return yield* fail(
        "USAGE_ERROR",
        `Local store "${config.name}" is not running.`,
        { suggestion: `Start it first with: ${startCommand(config.name)}` }
      );
    }
  });

const list = (name: string) =>
  Effect.gen(function* () {
    yield* configOf(name);

    return (yield* all).filter((each) => each.environment === name);
  });

const available = (name: string) => Effect.andThen(configOf(name), () => all);

const backupTarget = (backup: Pick<Backup, "id" | "name">) => ({
  id: backup.id,
  name: backup.name,
  scope: {},
  type: "local-backup",
});

const megabytes = (dir: string) => {
  const bytes = readdirSync(dir).reduce(
    (sum, file) => sum + statSync(path.join(dir, file)).size,
    0
  );

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const fileStep = <A>(what: string, run: () => A) =>
  Effect.try({
    catch: () => fail("LOCAL_STATE_ERROR", `Could not ${what}.`),
    try: run,
  });

// Dumps the database and packs the media files, inside the containers, then copies
// both out. Written to a hidden folder first, so an interrupted run leaves no backup.
const makeBackup = (config: LocalConfig, name: string) =>
  Effect.gen(function* () {
    const compose = yield* composeOf(config.name);
    const store = path.join(backupsDir(), config.name);
    const partial = path.join(store, `.${name}.partial-${process.pid}`);
    const done = path.join(store, name);

    yield* fileStep("prepare the backup folder", () => {
      rmSync(partial, { force: true, recursive: true });
      mkdirSync(partial, { mode: 0o700, recursive: true });
    });

    yield* dumpDatabase(compose, partial);
    yield* packMedia(compose, partial);

    const manifest: Manifest = {
      createdAt: new Date().toISOString(),
      name,
      saleorVersion: config.saleorVersion,
      store: config.name,
    };

    return yield* fileStep("save the backup", () => {
      writeFileSync(
        path.join(partial, "backup.json"),
        JSON.stringify(manifest, null, 2),
        { mode: 0o600 }
      );

      for (const file of ["db.dump", "media.tgz"]) {
        chmodSync(path.join(partial, file), 0o600);
      }

      renameSync(partial, done);

      return { backup: backupOf(manifest), size: megabytes(done) };
    });
  }).pipe(
    Effect.onError(() =>
      Effect.sync(() => {
        rmSync(
          path.join(
            backupsDir(),
            config.name,
            `.${name}.partial-${process.pid}`
          ),
          { force: true, recursive: true }
        );
      })
    )
  );

const add = (storeName: string, name: string) =>
  Effect.gen(function* () {
    const config = yield* configOf(storeName);

    if (!NAME.test(name)) {
      return yield* fail(
        "USAGE_ERROR",
        "Local backup names start with a letter or digit and contain only letters, digits, dots, hyphens and underscores (up to 100 characters)."
      );
    }

    const existing = (yield* list(storeName)).find(
      (each) => each.name === name
    );

    if (existing !== undefined) {
      return {
        action: "reuse",
        apply: Effect.succeed({
          data: { ...existing, created: false },
          text: "",
        }),
        details: { path: folderOf(existing) },
        risk: null,
        state: "exists",
        target: backupTarget(existing),
      } satisfies Planned<Ensured<BackupAdded>, never>;
    }

    yield* requireRunning(config);

    const apply = withInstanceLock(
      storeName,
      Effect.gen(function* () {
        const { backup, size } = yield* makeBackup(config, name);

        return {
          data: { ...backup, created: true },
          target: backupTarget(backup),
          text: [
            `Saved in ${folderOf(backup)} (${size}).`,
            `Restore it with: ${command("backup", "restore", envWord(localRef(storeName)), "--backup", backup.id)}`,
          ].join("\n"),
        };
      })
    );

    return {
      action: "create",
      apply,
      details: { path: path.join(backupsDir(), storeName, name) },
      risk: null,
      state: "absent",
      summary: [
        ["Store", `local:${storeName}`],
        ["Saved in", path.join(backupsDir(), storeName, name)],
      ],
      target: {
        ...backupTarget({ id: `${storeName}/${name}`, name }),
        id: null,
      },
    } satisfies Planned<Ensured<BackupAdded>, unknown>;
  });

const remove = (storeName: string, backup: Backup) =>
  Effect.gen(function* () {
    yield* configOf(storeName);

    return {
      action: "delete",
      apply: fileStep("delete the backup", () => {
        rmSync(folderOf(backup), { force: true, recursive: true });

        return {};
      }),
      details: { ...backup, path: folderOf(backup) },
      risk: "The backup is deleted. This cannot be undone.",
      state: "exists",
      summary: [["Made from", `local:${backup.environment ?? "?"}`]],
      target: backupTarget(backup),
    } satisfies Planned<object, never>;
  });

const versionParts = (version: string) =>
  version.split(".").map((part) => Math.trunc(Number(part)) || 0);

// Whether `a` is a newer Saleor than `b`.
const newer = (a: string, b: string) => {
  const [x, y] = [versionParts(a), versionParts(b)];

  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);

    if (diff !== 0) {
      return diff > 0;
    }
  }

  return false;
};

const restore = (
  storeName: string,
  backup: Backup,
  { timeout }: { readonly timeout: number }
) =>
  Effect.gen(function* () {
    const config = yield* configOf(storeName);

    if (!existsSync(path.join(folderOf(backup), "db.dump"))) {
      return yield* fail(
        "LOCAL_STATE_ERROR",
        `Backup "${backup.id}" has no database dump.`,
        { suggestion: `Check or delete ${folderOf(backup)}.` }
      );
    }

    if (newer(backup.saleorVersion, config.saleorVersion)) {
      return yield* fail(
        "USAGE_ERROR",
        `Backup "${backup.id}" was made with Saleor ${backup.saleorVersion}, newer than local store "${storeName}" (${config.saleorVersion}). Saleor cannot go back to an older version.`,
        {
          suggestion: `Restore it into a store of Saleor ${backup.saleorVersion} or newer.`,
        }
      );
    }

    yield* requireRunning(config);

    const store = localStore(config, "ready");

    return {
      action: "update",
      apply: withInstanceLock(
        storeName,
        Effect.gen(function* () {
          yield* replaceData(config, folderOf(backup));
          yield* waitForApi(config, timeout);

          return {
            data: {
              ...store,
              backup,
              created: false as const,
            } satisfies Restored,
            headline: `Restored local store "${storeName}" from backup "${backup.id}".`,
            text: "The admin login is unchanged.",
          };
        })
      ),
      details: { backup: { ...backup }, path: folderOf(backup) },
      risk: "Its database and media files are replaced with the backup's. This cannot be undone.",
      state: "ready",
      summary: [
        ["Backup", backup.id],
        [
          "Saleor",
          `${backup.saleorVersion}, restored into ${config.saleorVersion}`,
        ],
        ["Created", backup.createdAt.slice(0, 16).replace("T", " ")],
      ],
      target: localTarget(storeName),
    } satisfies Planned<Ensured<Restored>, unknown>;
  });

export const localBackups = {
  add: (store: string, name: string) => add(store, name),
  available,
  list,
  remove,
  restore,
} satisfies BackupSource<unknown>;
