import { Effect, Schema } from "effect";
import { rmSync } from "node:fs";
import type { TargetRef } from "../../core/action.ts";
import { type CliFailure, fail } from "../../core/errors.ts";
import { type StoreState, storeFrom } from "../../core/store.ts";
import { command } from "../../core/invocation.ts";
import { withLock } from "../../core/lock.ts";
import { notice, withProgress } from "../../core/output.ts";
import {
  deadlineIn,
  heartbeat,
  isPast,
  notReady,
  POLL,
} from "../../core/readiness.ts";
import { storeAnswers } from "../../core/store-api.ts";
import { SecretStore } from "../../core/secret-store.ts";
import { localRef } from "../../core/ref.ts";
import type { LocalConfig } from "./compose.ts";
import { checkDocker, Docker } from "./docker.ts";
import {
  adminEmail,
  composeArgs,
  ensureConfig,
  freePorts,
  instanceDir,
  listInstanceNames,
  localName,
  localsDir,
  portInUse,
  prepareSecrets,
  readConfig,
  requireCompatible,
  requireVersionFormat,
  saveConfig,
  secretKey,
  startCommand,
  withMailPort,
} from "./state.ts";

// Serialize lifecycle writes to one instance, so two commands never race migrations.
const withInstanceLock = <A, R>(
  name: string,
  effect: Effect.Effect<A, CliFailure, R>
) =>
  withLock({
    dir: localsDir(),
    name,
    busyMessage: `Another command is updating local store "${name}".`,
    effect,
  });

export const localTarget = (name: string): TargetRef => ({
  id: null,
  name,
  scope: {},
  type: "local-store",
});

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

const graphqlUrlOf = (config: LocalConfig) =>
  `http://localhost:${config.apiPort}/graphql/`;

// The shared instance fields (see core/target.ts) plus the local mail inbox.
export const localStore = (config: LocalConfig, state: StoreState) => ({
  ...storeFrom({
    dashboardUrl: `http://localhost:${config.dashboardPort}/`,
    graphqlUrl: graphqlUrlOf(config),
    kind: "local",
    name: config.name,
    ref: localRef(config.name),
    saleorVersion: config.saleorVersion,
    state,
  }),
  mailUrl:
    config.mailPort === undefined
      ? null
      : `http://localhost:${config.mailPort}/`,
});

export interface LocalUpOptions {
  readonly name: string;
  readonly newPorts?: boolean;
  readonly saleorVersion: string | undefined;
  readonly sampleData: boolean;
  readonly timeout: number;
}

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

const containersOf = (name: string) =>
  Effect.gen(function* () {
    const docker = yield* Docker;

    const raw = yield* docker.run(
      composeArgs(name, ["ps", "--all", "--format", "json"])
    );

    return yield* Effect.try({
      catch: () =>
        fail(
          "DOCKER_FAILED",
          "Docker returned an unreadable container status."
        ),
      try: () => parseContainers(raw),
    });
  });

const isRunning = (
  containers: readonly { Service: string; State: string }[],
  service: string
) =>
  containers.some(
    (container) =>
      container.Service === service && container.State === "running"
  );

// Docker publishes a port even when another program already listens on it, and the
// API then never answers. Checked before starting so the conflict is named instead of
// surfacing as a readiness timeout that no retry can fix.
const requireFreePorts = (
  config: LocalConfig,
  containers: readonly { Service: string; State: string }[]
) =>
  Effect.gen(function* () {
    const published = [
      ["api", "GraphQL API", config.apiPort],
      ["dashboard", "Dashboard", config.dashboardPort],
      ["mailpit", "mail inbox", config.mailPort],
    ] as const;

    for (const [service, label, port] of published) {
      if (
        port !== undefined &&
        !isRunning(containers, service) &&
        (yield* portInUse(port))
      ) {
        return yield* fail(
          "PORT_IN_USE",
          `Port ${port}, used by the ${label} of local store "${config.name}", is taken by another program.`,
          {
            details: { port, service },
            suggestion: `Stop that program (see it with: lsof -nP -iTCP:${port} -sTCP:LISTEN), or move the store to new ports: ${startCommand(config.name, "--new-ports")}`,
          }
        );
      }
    }
  });

const MISSING_IMAGE = /not found|manifest unknown|failed to resolve reference/i;

// A version that was never published fails the pull; say that rather than "check Docker".
const explainPullFailure = (config: LocalConfig) => (failure: CliFailure) =>
  failure.code === "IMAGE_PULL_FAILED" &&
  MISSING_IMAGE.test(failure.message) &&
  failure.message.includes(`saleor/saleor:${config.saleorVersion}`)
    ? Effect.fail(
        fail(
          "USAGE_ERROR",
          `Saleor ${config.saleorVersion} is not published as a Docker image (ghcr.io/saleor/saleor:${config.saleorVersion}).`,
          {
            suggestion: `Pick a released version from https://github.com/saleor/saleor/releases, then run: ${command("init", "--local", "--name", config.name, "--saleor-version", "<version>")}`,
          }
        )
      )
    : Effect.fail(failure);

const reassignPorts = (config: LocalConfig) =>
  Effect.gen(function* () {
    const [apiPort = 0, dashboardPort = 0, mailPort = 0] = yield* freePorts(3, [
      config.apiPort,
      config.dashboardPort,
      ...(config.mailPort === undefined ? [] : [config.mailPort]),
    ]);

    const updated: LocalConfig = {
      ...config,
      apiPort,
      dashboardPort,
      mailPort,
    };

    yield* saveConfig(updated);

    return updated;
  });

// Pulls images on first setup, migrates, creates the admin (and sample data), then
// starts every container. Each step is idempotent, so a failed run can be repeated.
const setUp = (
  config: LocalConfig,
  loadingSampleData: boolean,
  compose: (args: readonly string[]) => Effect.Effect<string, CliFailure>
) =>
  Effect.gen(function* () {
    if (!config.initialized) {
      yield* withProgress(
        "Downloading Saleor images (the first run can take several minutes)…",
        "Saleor images downloaded.",
        compose(["pull"]).pipe(
          Effect.catchTag("CliFailure", explainPullFailure(config))
        )
      );
    }

    yield* withProgress(
      "Starting the database…",
      "Database started.",
      compose(["up", "-d", "--wait", "db", "cache", "mailpit"])
    );
    yield* withProgress(
      "Preparing the database…",
      "Database ready.",
      compose([
        "run",
        "--rm",
        "-T",
        "api",
        "python",
        "manage.py",
        "migrate",
        "--noinput",
      ])
    );
    yield* withProgress(
      loadingSampleData ? "Loading sample data…" : "Preparing your store…",
      "Store prepared.",
      compose([
        "run",
        "--rm",
        "-T",
        "api",
        "python",
        "manage.py",
        "shell",
        "-c",
        bootstrap(config.sampleData),
      ])
    );
    const ready: LocalConfig = { ...config, initialized: true };
    yield* saveConfig(ready);
    yield* withProgress(
      "Starting Saleor…",
      "Saleor started.",
      compose(["up", "-d"])
    );

    return ready;
  });

export const up = (options: LocalUpOptions) =>
  Effect.gen(function* () {
    yield* localName(options.name);
    yield* checkDocker;

    return yield* withInstanceLock(
      options.name,
      Effect.gen(function* () {
        const docker = yield* Docker;

        const ensured = yield* ensureConfig(
          options.name,
          options.saleorVersion,
          options.sampleData
        );

        // An instance whose first setup finishes in this run counts as created.
        const created = ensured.created || !ensured.config.initialized;
        let config = yield* withMailPort(ensured.config);

        const changed =
          ensured.changed ||
          config !== ensured.config ||
          options.newPorts === true;

        const compose = (args: readonly string[]) =>
          docker.run(composeArgs(config.name, args));

        const containers = yield* containersOf(config.name);

        if (options.newPorts) {
          yield* compose(["stop"]);
          config = yield* reassignPorts(config);
        }

        const secrets = yield* prepareSecrets(config);

        const outcome = () => ({
          ...localStore(config, "ready"),
          admin: { email: adminEmail, password: secrets.password },
          created,
        });

        // Already running and set up with these options: nothing to do.
        if (
          config.initialized &&
          !changed &&
          isRunning(containers, "api") &&
          (yield* storeAnswers(graphqlUrlOf(config)))
        ) {
          return outcome();
        }

        yield* requireFreePorts(config, options.newPorts ? [] : containers);
        config = yield* setUp(
          config,
          config.sampleData && ensured.changed,
          compose
        );
        const graphqlUrl = graphqlUrlOf(config);

        // Image downloads/migrations have their own Docker progress. The API wait budget
        // starts after the containers have been launched, so --timeout 0 still sets up.
        const deadline = deadlineIn(options.timeout);
        yield* notice(`Waiting for the GraphQL API at ${graphqlUrl}…`);

        const beat = heartbeat();

        while (!(yield* storeAnswers(graphqlUrl))) {
          if (isPast(deadline)) {
            return yield* notReady(
              "the local GraphQL API is not responding yet.",
              { instance: localStore(config, "starting") },
              "Docker"
            );
          }

          yield* beat("waiting for the GraphQL API");
          yield* Effect.sleep(POLL);
        }

        return outcome();
      })
    );
  });

const describeInstance = (config: LocalConfig) =>
  Effect.gen(function* () {
    const containers = yield* containersOf(config.name);
    const apiRunning = isRunning(containers, "api");
    const answers = apiRunning && (yield* storeAnswers(graphqlUrlOf(config)));

    let state: StoreState = "stopped";

    if (!config.initialized) {
      state = "incomplete";
    } else if (answers) {
      state = "ready";
    } else if (apiRunning) {
      state = "starting";
    }

    return { ...localStore(config, state), containers };
  });

export const list = Effect.gen(function* () {
  const names = yield* listInstanceNames();

  if (names.length === 0) {
    return [];
  }

  // Without a Docker engine nothing can be running: list every instance as stopped
  // instead of failing, so a person can still see what they have.
  const engine = yield* checkDocker.pipe(
    Effect.as(true),
    Effect.catchIf(
      (error) =>
        error.code === "DOCKER_NOT_RUNNING" || error.code === "DOCKER_MISSING",
      (error) =>
        Effect.as(notice(`${error.message} Every store is stopped.`), false)
    )
  );

  const instances = yield* Effect.forEach(names, (name) =>
    Effect.gen(function* () {
      const config = yield* readConfig(name);

      if (config === undefined) {
        return [];
      }

      if (!engine) {
        return [localStore(config, "stopped")];
      }

      const { containers: _, ...shown } = yield* describeInstance(config);

      return [shown];
    })
  );

  return instances.flat();
});

// Read-only: what `up` would do with these options.
export const planUp = (options: LocalUpOptions) =>
  Effect.gen(function* () {
    yield* localName(options.name);
    yield* requireVersionFormat(options.saleorVersion);
    const existing = yield* readConfig(options.name);

    if (existing === undefined) {
      return { action: "create" as const, state: "absent" as const };
    }

    // A first setup that never finished is finished by this run.
    if (!existing.initialized) {
      return { action: "create" as const, state: "incomplete" as const };
    }

    yield* requireCompatible(existing, options.saleorVersion);
    yield* checkDocker;
    const { state } = yield* describeInstance(existing);

    return {
      action:
        options.sampleData && !existing.sampleData
          ? ("update" as const)
          : ("reuse" as const),
      state,
    };
  });

// Read-only: the instance `down` would stop, or nothing.
export const planDown = (name: string) =>
  Effect.gen(function* () {
    yield* localName(name);
    const config = yield* readConfig(name);

    if (config === undefined) {
      return;
    }

    yield* checkDocker;
    const { containers: _, ...details } = yield* describeInstance(config);

    return details;
  });

// Stops the instance; with `deleteData`, also removes its volumes, credentials and
// files. Confirmation is the caller's: this only acts.
export const down = (name: string, deleteData: boolean) =>
  Effect.gen(function* () {
    yield* localName(name);
    yield* checkDocker;

    return yield* withInstanceLock(
      name,
      Effect.gen(function* () {
        const docker = yield* Docker;
        const containers = yield* containersOf(name);

        const wasRunning = containers.some(
          (container) => container.State === "running"
        );

        yield* docker.run(
          composeArgs(name, ["down", ...(deleteData ? ["--volumes"] : [])])
        );

        if (deleteData) {
          const store = yield* SecretStore;
          yield* store.remove(secretKey(name));
          yield* Effect.sync(() => {
            rmSync(instanceDir(name), { force: true, recursive: true });
          });
        }

        return { wasRunning };
      })
    );
  });
