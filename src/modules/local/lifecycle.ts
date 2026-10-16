import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { type CliFailure, fail } from "../../core/errors.ts";
import { confirmDestructive } from "../../core/interaction.ts";
import { notice } from "../../core/output.ts";
import {
  deadlineIn,
  isPast,
  notReady,
  POLL,
  probeGraphql,
} from "../../core/readiness.ts";
import { SecretStore, SecretStoreLive } from "../../core/secret-store.ts";
import { type Target, targetData, writeTargetRef } from "../../core/target.ts";
import type { LocalConfig } from "./compose.ts";
import { checkDocker, Docker } from "./docker.ts";
import {
  adminEmail,
  composeArgs,
  ensureConfig,
  instanceDir,
  localName,
  prepareSecrets,
  readConfig,
  saveConfig,
  secretKey,
} from "./state.ts";

// Serialize lifecycle writes to one instance. A crashed process leaves a PID that can
// be reclaimed; a live CLI gets an actionable retry instead of racing migrations.
const withInstanceLock = <A, R>(
  name: string,
  effect: Effect.Effect<A, CliFailure, R>
) =>
  Effect.acquireUseRelease(
    Effect.try({
      catch: () =>
        fail(
          "NOT_READY",
          `Another command is updating local instance "${name}".`,
          {
            retry: true,
            suggestion: "Wait for that command to finish, then try again.",
          }
        ),
      try: () => {
        const dir = instanceDir(name);
        mkdirSync(dir, { mode: 0o700, recursive: true });
        const lock = path.join(path.dirname(dir), `.${name}.lock`);

        if (existsSync(lock)) {
          const pid = Number(readFileSync(lock, "utf8"));
          let active = true;

          try {
            process.kill(pid, 0);
          } catch {
            active = false;
          }

          if (active) {
            throw new Error("Instance is busy");
          }

          rmSync(lock);
        }

        writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });

        return lock;
      },
    }),
    () => effect,
    (lock) => Effect.sync(() => rmSync(lock, { force: true }))
  );

const bootstrap = (sampleData: boolean) => `
import os
from django.core.management import call_command
from django.db import connection, transaction
from saleor.account.models import User
with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(736253)")
        cursor.execute("CREATE TABLE IF NOT EXISTS saleor_cli_bootstrap (step text PRIMARY KEY)")
        cursor.execute("SELECT step FROM saleor_cli_bootstrap WHERE step = 'sample-data'")
        seeded = cursor.fetchone() is not None
        if ${sampleData ? "True" : "False"} and not seeded:
            call_command("populatedb", withoutimages=True)
            cursor.execute("INSERT INTO saleor_cli_bootstrap (step) VALUES ('sample-data')")
    user, created = User.objects.get_or_create(email=os.environ["DJANGO_SUPERUSER_EMAIL"], defaults={"is_staff": True, "is_superuser": True, "is_active": True})
    if created:
        user.set_password(os.environ["DJANGO_SUPERUSER_PASSWORD"])
        user.save()
`;

export const localTarget = (config: LocalConfig): Target => ({
  credentials: Effect.gen(function* () {
    const store = yield* SecretStore;
    const raw = yield* store.get(secretKey(config.name));

    if (!raw) {
      return yield* fail(
        "TARGET_CREDENTIALS_REQUIRED",
        "The local admin credentials are missing. Run local up again."
      );
    }

    const secrets: { password: string } = JSON.parse(raw);

    const token = yield* Effect.tryPromise({
      catch: () =>
        fail(
          "TARGET_CREDENTIALS_REQUIRED",
          "Could not sign in to the local Saleor API.",
          {
            suggestion: `Start the instance with: saleor local up --name ${config.name}`,
          }
        ),
      try: async () => {
        const response = await fetch(
          `http://localhost:${config.apiPort}/graphql/`,
          {
            body: JSON.stringify({
              query:
                "mutation Login($email: String!, $password: String!) { tokenCreate(email: $email, password: $password) { token errors { message } } }",
              variables: { email: adminEmail, password: secrets.password },
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
            signal: AbortSignal.timeout(15_000),
          }
        );

        const body = Schema.decodeUnknownSync(
          Schema.Struct({
            data: Schema.Struct({
              tokenCreate: Schema.Struct({
                token: Schema.NullOr(Schema.String),
              }),
            }),
          })
        )(await response.json());

        if (!(response.ok && body.data.tokenCreate.token)) {
          throw new Error("Login failed");
        }

        return body.data.tokenCreate.token;
      },
    });

    return { token };
  }).pipe(Effect.provide(SecretStoreLive)),
  dashboardUrl: `http://localhost:${config.dashboardPort}/`,
  graphqlUrl: `http://localhost:${config.apiPort}/graphql/`,
  kind: "local",
  name: config.name,
  ref: `local:${config.name}`,
  saleorVersion: config.saleorVersion,
});

export interface LocalUpOptions {
  readonly link: boolean;
  readonly name: string;
  readonly saleorVersion: string | undefined;
  readonly sampleData: boolean;
  readonly timeout: number;
}

export const up = (options: LocalUpOptions) =>
  Effect.gen(function* () {
    yield* localName(options.name);
    yield* checkDocker;

    return yield* withInstanceLock(
      options.name,
      Effect.gen(function* () {
        const docker = yield* Docker;

        const { config, created } = yield* ensureConfig(
          options.name,
          options.saleorVersion,
          options.sampleData
        );

        const secrets = yield* prepareSecrets(config);

        const compose = (args: readonly string[]) =>
          docker.run(composeArgs(config.name, args));

        if (!config.initialized) {
          yield* notice(
            "Downloading the local Saleor images. The first run can take several minutes…"
          );
          yield* compose(["pull"]);
        }

        yield* notice("Starting the database and preparing Saleor…");
        yield* compose(["up", "-d", "--wait", "db", "cache", "mailpit"]);
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
          bootstrap(config.sampleData),
        ]);
        yield* saveConfig({ ...config, initialized: true });
        yield* compose(["up", "-d"]);
        const target = localTarget(config);

        const linkFile = options.link
          ? yield* writeTargetRef(target.ref)
          : null;

        // Image downloads/migrations have their own Docker progress. The API wait budget
        // starts after the containers have been launched, so --timeout 0 still sets up.
        const deadline = deadlineIn(options.timeout);
        yield* notice(`Waiting for the GraphQL API at ${target.graphqlUrl}…`);

        while (!(yield* probeGraphql(target.graphqlUrl))) {
          if (isPast(deadline)) {
            return yield* notReady(
              "the local GraphQL API is not responding yet.",
              { linkFile, target: targetData(target) },
              "Docker"
            );
          }

          yield* Effect.sleep(POLL);
        }

        return {
          ...targetData(target),
          admin: { email: adminEmail, password: secrets.password },
          created,
          linkFile,
          ready: true,
        };
      })
    );
  });

export const requireConfig = (name: string) =>
  Effect.gen(function* () {
    yield* localName(name);
    const config = yield* readConfig(name);

    if (!config) {
      return yield* fail(
        "NOT_FOUND",
        `Local instance "${name}" does not exist.`,
        { suggestion: `Create it with: saleor local up --name ${name}` }
      );
    }

    return config;
  });

const parseContainers = (raw: string) => {
  const text = raw.trim();

  const payload = text.startsWith("[")
    ? text
    : `[${text.split("\n").filter(Boolean).join(",")}]`;

  return Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({ Service: Schema.String, State: Schema.String })
    )
  )(JSON.parse(payload));
};

export const status = (name: string) =>
  Effect.gen(function* () {
    const config = yield* requireConfig(name);
    yield* checkDocker;
    const docker = yield* Docker;

    const raw = yield* docker.run(
      composeArgs(name, ["ps", "--all", "--format", "json"])
    );

    const containers = yield* Effect.try({
      catch: () =>
        fail("TASK_FAILED", "Docker returned an unreadable container status."),
      try: () => parseContainers(raw),
    });

    const apiRunning = containers.some(
      (container) =>
        container.Service === "api" && container.State === "running"
    );

    const target = localTarget(config);
    const ready = apiRunning && (yield* probeGraphql(target.graphqlUrl));
    const runningState = apiRunning ? "starting" : "stopped";

    return {
      ...targetData(target),
      containers,
      ready,
      state: ready ? "ready" : runningState,
    };
  });

export const down = (name: string, deleteData: boolean, force: boolean) =>
  Effect.gen(function* () {
    yield* localName(name);
    yield* requireConfig(name);

    if (deleteData) {
      yield* confirmDestructive(
        {
          question: `Delete local instance "${name}" and all its data?`,
          refusal: `Not deleting local instance "${name}" without confirmation.`,
        },
        force
      );
    }

    yield* checkDocker;

    return yield* withInstanceLock(
      name,
      Effect.gen(function* () {
        const docker = yield* Docker;
        yield* docker.run(
          composeArgs(name, ["down", ...(deleteData ? ["--volumes"] : [])])
        );

        if (deleteData) {
          const store = yield* SecretStore;
          yield* store.remove(secretKey(name));
          yield* Effect.sync(() =>
            rmSync(instanceDir(name), { force: true, recursive: true })
          );
        }

        return { deletedData: deleteData, name, state: "stopped" };
      })
    );
  });

export const resolveLocalTarget = (ref: string) =>
  Effect.gen(function* () {
    const explicitName = ref.startsWith("local:") ? ref.slice(6) : "";
    const name = ref === "local" ? "default" : explicitName;
    const config = yield* requireConfig(name);

    return localTarget(config);
  });
