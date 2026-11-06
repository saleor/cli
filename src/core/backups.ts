import { Effect, Option } from "effect";
import {
  absent,
  defineActions,
  defineGroup,
  type Ensured,
  listing,
  type Planned,
} from "./action.ts";
import { type CliFailure, fail } from "./errors.ts";
import type { Choice } from "./interaction.ts";
import { command } from "./invocation.ts";
import { SecretStore } from "./secret-store.ts";
import type { Backup, Restored, StoreSource } from "./store.ts";
import { storeTokenKey } from "./store-token.ts";
import { envInput, resolveStoreRef, withLogin } from "./stores.ts";
import { type Given, target } from "./target.ts";
import { envWord } from "./env-word.ts";

// `saleor backup`: copies of a store's data, kept where the store runs, and restoring
// a store from one. Like `env`, the commands are the same for every store and hand
// the work to its source; a source that keeps no backups (Docker) is refused.

const backup = defineActions();

const backupTarget = target({
  identifiedBy: "name or key, as backup list prints them",
  metavar: "name",
  name: "backup",
  noun: "backup",
});

const newBackupInput = backupTarget.input({ creates: true });
const backupInput = backupTarget.input();

// The store a backup command acts on, and the backups of the source that runs it.
const resolveBackups = (supplied: Given) =>
  Effect.gen(function* () {
    const { id, ref, source } = yield* resolveStoreRef(supplied, {
      can: "backups",
    });

    const { backups } = source;

    // resolveStoreRef already refuses sources without backups.
    if (backups === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `${source.label} stores cannot be backed up with the CLI.`
      );
    }

    return { backups, id, ref, source };
  });

const day = (created: string) => created.slice(0, 16).replace("T", " ");

const choicesOf = (
  source: StoreSource<never>,
  found: Effect.Effect<readonly Backup[], CliFailure>
) =>
  withLogin(
    source,
    Effect.map(found, (all) =>
      all.map((each): Choice<string> => ({
        hint: `${each.environment ?? "deleted environment"} · ${each.saleorVersion} · ${day(each.createdAt)}`,
        label: each.name,
        value: each.id,
      }))
    )
  );

// A backup by its key, or by its name when no other backup has it.
const findBackup = (backups: readonly Backup[], word: string) => {
  const exact = backups.find((each) => each.id === word);

  if (exact !== undefined) {
    return Effect.succeedSome(exact);
  }

  const named = backups.filter((each) => each.name === word);

  if (named.length > 1) {
    return Effect.fail(
      fail(
        "AMBIGUOUS_TARGET",
        `More than one backup is named "${word}": ${named.map((each) => each.id).join(", ")}.`,
        {
          details: { matches: named.map((each) => each.id) },
          suggestion: "Use the backup's key instead of its name.",
        }
      )
    );
  }

  return Effect.succeed(Option.fromUndefinedOr(named[0]));
};

const listCommand = backup.list({
  description:
    "List the backups made from a store: their names, keys, Saleor versions and when they were made. Saleor Cloud keeps the backups of its environments; local backups are kept on this computer.",
  examples: [
    {
      command: "saleor backup list staging",
      description: "See the backups of the staging environment",
    },
  ],
  inputs: { env: envInput },
  name: "list",
  run: (input) =>
    Effect.gen(function* () {
      const { backups, id, ref, source } = yield* resolveBackups(input.env);
      const found = yield* withLogin(source, backups.list(id));

      return listing(
        found,
        [
          ["NAME", (row) => row.name],
          ["KEY", (row) => row.id],
          ["VERSION", (row) => row.saleorVersion],
          ["TYPE", (row) => row.type],
          ["CREATED", (row) => day(row.createdAt)],
        ],
        `No backups yet. Make one with: ${command("backup", "add", envWord(ref))}`
      );
    }),
  summary: "List a store's backups.",
});

const defaultName = () =>
  `backup-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}`;

const addCommand = backup.ensure({
  description:
    "Back up a store's data under a name, and wait until the backup is made. Adding a name the store already has a backup under reuses it. A local store must be running: its database and media files are copied to this computer. Saleor Cloud keeps the backups of its environments.",
  examples: [
    {
      command: "saleor backup add staging --backup before-import",
      description: "Back up the staging environment",
    },
  ],
  inputs: { backup: newBackupInput, env: envInput },
  name: "add",
  plan: (input) =>
    Effect.gen(function* () {
      const { backups, id, source } = yield* resolveBackups(input.env);

      const name = yield* newBackupInput.resolve(input.backup, {
        choices: Effect.map(
          choicesOf(source, backups.list(id)),
          // A person picks an existing one by name, which is what `add` takes.
          (all) => all.map((each) => ({ ...each, value: each.label }))
        ),
        create: {
          label: "Make a new backup",
          placeholder: defaultName(),
          prompt: "Backup name (leave blank for a dated one)",
          whenBlank: defaultName,
        },
      });

      return yield* withLogin(
        source,
        backups.add(id, name, { timeout: input.timeout })
      );
    }),
  summary: "Back up a store's data.",
  waits: true,
});

const removeCommand = backup.remove({
  description:
    "Delete a backup. Asks for confirmation in a terminal; needs --force otherwise. Never reads SALEOR_ENV: name the store whose backups to choose from. In Saleor Cloud, any backup of the store's organization can be named, including those of deleted environments. Removing a backup that does not exist succeeds.",
  examples: [
    {
      command: "saleor backup remove staging --backup before-import --force",
      description: "Delete a backup without a question",
    },
  ],
  inputs: { backup: backupInput, env: envInput },
  name: "remove",
  plan: (input) =>
    Effect.gen(function* () {
      const { backups, id, source } = yield* resolveBackups(input.env);
      const available = withLogin(source, backups.available(id));

      const word = yield* backupInput.resolve(input.backup, {
        choices: choicesOf(source, backups.available(id)),
        emptyHint: "There are no backups to delete.",
      });

      const found = yield* findBackup(yield* available, word);

      if (Option.isNone(found)) {
        return absent({ id: null, name: word, scope: {}, type: "backup" });
      }

      return yield* withLogin(source, backups.remove(id, found.value));
    }),
  risk: "Deletes the backup. This cannot be undone.",
  summary: "Delete a backup.",
});

const restoreCommand = backup.ensure({
  description:
    "Replace all of a store's data with a backup's, and wait until it is restored. Any backup of the same place can be restored, including another store's: in Saleor Cloud, any of the organization's, such as production's into a sandbox; locally, any local backup made with the same Saleor version or an older one. Asks for confirmation in a terminal; needs --force otherwise. Store tokens saved for the store are forgotten, since the restored data does not have them.",
  examples: [
    {
      command: "saleor backup restore staging --backup before-import",
      description: "Put the staging environment back as it was",
    },
  ],
  inputs: { backup: backupInput, env: envInput },
  name: "restore",
  plan: (input) =>
    Effect.gen(function* () {
      const { backups, id, ref, source } = yield* resolveBackups(input.env);
      const secrets = yield* SecretStore;

      const word = yield* backupInput.resolve(input.backup, {
        choices: choicesOf(source, backups.available(id)),
        emptyHint: `Make one with: ${command("backup", "add", envWord(ref))}`,
      });

      const found = yield* findBackup(
        yield* withLogin(source, backups.available(id)),
        word
      );

      if (Option.isNone(found)) {
        return yield* fail("NOT_FOUND", `There is no backup "${word}".`, {
          suggestion: `See the store's backups with: ${command("backup", "list", envWord(ref))}`,
        });
      }

      const planned = yield* withLogin(
        source,
        backups.restore(id, found.value, { timeout: input.timeout })
      );

      return {
        ...planned,
        apply: Effect.tap(planned.apply, () =>
          secrets.remove(storeTokenKey(ref))
        ),
      } satisfies Planned<Ensured<Restored>, never>;
    }),
  risk: "Replaces all the store's data with the backup's. This cannot be undone.",
  summary: "Restore a store from a backup.",
  waits: true,
});

export const backupCommand = defineGroup({
  actions: [listCommand, addCommand, removeCommand, restoreCommand],
  description:
    "Backups are copies of a store's data, kept where the store runs: Saleor Cloud keeps its environments' backups, and local stores' backups are kept on this computer, where they outlive the store. Every command names its store with the word after it, as env does: a name from saleor.yml or a store ref.",
  name: "backup",
  summary: "Back up and restore a store's data.",
});
