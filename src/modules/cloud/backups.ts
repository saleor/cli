import { Effect, Option } from "effect";
import type { Ensured, Planned } from "../../core/action.ts";
import { envWord } from "../../core/env-word.ts";
import { fail } from "../../core/errors.ts";
import { command } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import { deadlineIn } from "../../core/readiness.ts";
import type {
  Backup,
  BackupAdded,
  BackupSource,
  Restored,
} from "../../core/store.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  type BackupResponse,
  createEnvironmentBackups,
  destroyBackup,
  listBackups,
  listEnvironmentBackups,
  restoreEnvironmentRestoreEnvironment,
} from "./api/contract.ts";
import {
  describeEnvironment,
  environmentTarget,
  findCloudEnvironment,
  parseCloudId,
} from "./lookup.ts";
import { waitForTask } from "./readiness.ts";

// Saleor Cloud's backups of its environments. Backups belong to the organization and
// outlive the environment they were made from, so any of them can be restored into
// any environment there.

const backupOf = (response: BackupResponse): Backup => ({
  createdAt: response.created,
  environment: response.environment_name,
  id: response.key,
  name: response.name,
  saleorVersion: response.saleor_version,
  type: response.backup_type.toLowerCase(),
});

const newestFirst = (backups: readonly Backup[]) =>
  backups.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));

// The environment a ref's id names, which must exist.
const environmentOf = (id: string) =>
  Effect.gen(function* () {
    const parsed = parseCloudId(id);

    if (Option.isNone(parsed)) {
      return yield* fail(
        "USAGE_ERROR",
        `"cloud:${id}" is not a Cloud ref: they look like cloud:<org>/<env key>.`
      );
    }

    const { environment, organization } = parsed.value;
    const found = yield* findCloudEnvironment(organization, environment);

    if (Option.isNone(found)) {
      return yield* fail(
        "NOT_FOUND",
        `Environment "${environment}" does not exist in ${organization}.`
      );
    }

    return { env: found.value, organization };
  });

const list = (id: string) =>
  Effect.gen(function* () {
    const { env, organization } = yield* environmentOf(id);
    const api = yield* CloudApi;

    const found = yield* orDescribe(
      api.call(listEnvironmentBackups, {
        path: { environment_pk: env.key, organization_slug: organization },
      })
    );

    return newestFirst(found.map(backupOf));
  });

const available = (id: string) =>
  Effect.gen(function* () {
    const { organization } = yield* environmentOf(id);
    const api = yield* CloudApi;

    const found = yield* orDescribe(
      api.call(listBackups, { path: { organization_slug: organization } })
    );

    return newestFirst(found.map(backupOf));
  });

const backupTarget = (organization: string, backup: Backup) => ({
  id: backup.id,
  name: backup.name,
  scope: { organization },
  type: "backup",
});

const add = (
  id: string,
  name: string,
  { timeout }: { readonly timeout: number }
) =>
  Effect.gen(function* () {
    const { env, organization } = yield* environmentOf(id);
    const existing = (yield* list(id)).find((each) => each.name === name);

    if (existing !== undefined) {
      return {
        action: "reuse",
        apply: Effect.succeed({
          data: { ...existing, created: false },
          text: "",
        }),
        details: { environment: env.key },
        risk: null,
        state: "exists",
        target: backupTarget(organization, existing),
      } satisfies Planned<Ensured<BackupAdded>, never>;
    }

    const apply = Effect.gen(function* () {
      const api = yield* CloudApi;

      const made = yield* orDescribe(
        api.call(createEnvironmentBackups, {
          body: { name },
          path: { environment_pk: env.key, organization_slug: organization },
        })
      );

      if (made.task_id !== null) {
        yield* notice(`Backing up environment "${env.name}" (${env.key})…`);
        yield* waitForTask({
          deadline: deadlineIn(timeout),
          label: "The backup",
          taskId: made.task_id,
        });
      }

      const backup = backupOf(made);

      return {
        data: { ...backup, created: true },
        target: backupTarget(organization, backup),
        text: `Restore it with: ${command("backup", "restore", envWord(`cloud:${organization}/${env.key}`), "--backup", backup.id)}`,
      };
    });

    return {
      action: "create",
      apply,
      details: { environment: env.key },
      risk: null,
      state: "absent",
      summary: [["Environment", `${env.name} (${env.key})`]],
      target: { id: null, name, scope: { organization }, type: "backup" },
    } satisfies Planned<Ensured<BackupAdded>, CloudApi>;
  });

const remove = (id: string, backup: Backup) =>
  Effect.gen(function* () {
    const { organization } = yield* environmentOf(id);

    const apply = Effect.gen(function* () {
      const api = yield* CloudApi;

      yield* api
        .call(destroyBackup, {
          path: { id: backup.id, organization_slug: organization },
        })
        .pipe(
          // Deleted meanwhile: what was asked for is done.
          Effect.catchTag("ApiStatusError", (error) =>
            error.status === 404 ? Effect.void : Effect.fail(error)
          ),
          orDescribe
        );

      return {};
    });

    return {
      action: "delete",
      apply,
      details: { ...backup },
      risk: "The backup is deleted. This cannot be undone.",
      state: "exists",
      summary: [
        ["Made from", backup.environment ?? "a deleted environment"],
        ["Created", backup.createdAt.slice(0, 16).replace("T", " ")],
      ],
      target: backupTarget(organization, backup),
    } satisfies Planned<object, CloudApi>;
  });

const restore = (
  id: string,
  backup: Backup,
  { timeout }: { readonly timeout: number }
) =>
  Effect.gen(function* () {
    const { env, organization } = yield* environmentOf(id);
    const store = describeEnvironment(organization, env);

    const apply = Effect.gen(function* () {
      const api = yield* CloudApi;

      const started = yield* orDescribe(
        api.call(restoreEnvironmentRestoreEnvironment, {
          body: { restore_from: backup.id },
          path: { id: env.key, organization_slug: organization },
        })
      );

      if (started.task_id !== null) {
        yield* notice(
          `Restoring environment "${env.name}" (${env.key}) from "${backup.name}"…`
        );
        yield* waitForTask({
          deadline: deadlineIn(timeout),
          label: "The restore",
          taskId: started.task_id,
        });
      }

      return {
        data: { ...store, backup, created: false as const } satisfies Restored,
        headline: `Restored environment "${env.name}" (${env.key}) from backup "${backup.name}".`,
        text: "",
      };
    });

    return {
      action: "update",
      apply,
      details: { backup: { ...backup }, environment: env.key },
      risk: "All its data is replaced with the backup's. This cannot be undone.",
      state: store.state,
      summary: [
        ["Backup", `${backup.name} (${backup.id})`],
        ["Made from", backup.environment ?? "a deleted environment"],
        [
          "Saleor",
          `${backup.saleorVersion}, restored into ${env.service.version}`,
        ],
        ["Created", backup.createdAt.slice(0, 16).replace("T", " ")],
      ],
      target: environmentTarget(organization, env),
    } satisfies Planned<Ensured<Restored>, CloudApi>;
  });

export const cloudBackups = {
  add,
  available,
  list,
  remove,
  restore,
} satisfies BackupSource<unknown>;
