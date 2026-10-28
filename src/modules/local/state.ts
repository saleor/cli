import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { Effect, Predicate, Schema } from "effect";
import { fail } from "../../core/errors.ts";
import { command } from "../../core/invocation.ts";
import { configDir, SecretStore } from "../../core/secret-store.ts";
import {
  composeTemplate,
  type LocalConfig,
  SALEOR_VERSION,
} from "./compose.ts";

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

// Why a local instance name is not allowed, if it is not. Names become Docker project
// names and directory names, so they are restricted before anything else runs.
// The command that creates or starts a local instance, for hints.
export const startCommand = (name: string, ...extra: readonly string[]) =>
  command("local", "up", "--name", name, ...extra);

export const nameProblem = (name: string) =>
  NAME_PATTERN.test(name)
    ? undefined
    : "Local names must start with a lowercase letter and contain only lowercase letters, digits and hyphens (up to 40 characters).";

export const localName = (name: string) => {
  const problem = nameProblem(name);

  return problem === undefined
    ? Effect.succeed(name)
    : Effect.fail(fail("USAGE_ERROR", problem));
};

export const localsDir = () => path.join(configDir(), "local");

export const instanceDir = (name: string) => path.join(localsDir(), name);

export const composeArgs = (name: string, args: readonly string[]) => [
  "compose",
  "--project-name",
  `saleor-${name}`,
  "--project-directory",
  instanceDir(name),
  "--file",
  path.join(instanceDir(name), "compose.yaml"),
  ...args,
];

const ConfigSchema = Schema.Struct({
  apiPort: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 65_535, minimum: 1 }))
  ),
  dashboardPort: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 65_535, minimum: 1 }))
  ),
  initialized: Schema.Boolean,
  mailPort: Schema.optionalKey(
    Schema.Int.pipe(
      Schema.check(Schema.isBetween({ maximum: 65_535, minimum: 1 }))
    )
  ),
  name: Schema.String,
  saleorVersion: Schema.String,
  sampleData: Schema.Boolean,
});

export const readConfig = (name: string) =>
  Effect.try({
    catch: () =>
      fail(
        "LOCAL_STATE_ERROR",
        `Local instance "${name}" has an unreadable configuration.`,
        {
          suggestion: `Check or remove ${path.join(instanceDir(name), "instance.json")}.`,
        }
      ),
    try: () => {
      const file = path.join(instanceDir(name), "instance.json");

      return existsSync(file)
        ? Schema.decodeUnknownSync(ConfigSchema)(
            JSON.parse(readFileSync(file, "utf8"))
          )
        : undefined;
    },
  });

export const saveConfig = (config: LocalConfig) =>
  Effect.try({
    catch: () =>
      fail(
        "LOCAL_STATE_ERROR",
        "Could not save the local instance configuration."
      ),
    try: () => {
      const dir = instanceDir(config.name);
      mkdirSync(dir, { mode: 0o700, recursive: true });
      const temp = path.join(dir, `instance.${process.pid}.tmp`);
      writeFileSync(temp, JSON.stringify(config), { mode: 0o600 });
      renameSync(temp, path.join(dir, "instance.json"));
      writeFileSync(path.join(dir, "compose.yaml"), composeTemplate(config), {
        mode: 0o600,
      });
    },
  });

const availablePort = () =>
  Effect.tryPromise({
    catch: () => fail("PORT_IN_USE", "Could not allocate a local port."),
    try: () =>
      new Promise<number>((resolve, reject) => {
        const server = net.createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();

          if (address === null || Predicate.isString(address)) {
            server.close();
            reject(new Error("No TCP port assigned"));

            return;
          }

          server.close((error) =>
            error ? reject(error) : resolve(address.port)
          );
        });
      }),
  });

// `count` distinct free ports, none of them in `avoid`.
export const freePorts = (count: number, avoid: readonly number[] = []) =>
  Effect.gen(function* () {
    const ports: number[] = [];

    while (ports.length < count) {
      const port = yield* availablePort();

      if (!(ports.includes(port) || avoid.includes(port))) {
        ports.push(port);
      }
    }

    return ports;
  });

// A set-up instance keeps its version: asking for another one is a conflict.
export const requireCompatible = (
  existing: LocalConfig,
  version: string | undefined
) =>
  existing.initialized &&
  version !== undefined &&
  version !== existing.saleorVersion
    ? Effect.fail(
        fail(
          "NAME_CONFLICT",
          `Local instance "${existing.name}" already exists but its Saleor version is "${existing.saleorVersion}", not "${version}".`,
          {
            details: { saleorVersion: existing.saleorVersion, wanted: version },
            suggestion: `Leave out --saleor-version to use it as it is, or create another instance: ${command("init", "--local", "--name", `${existing.name}-${version.replaceAll(".", "-")}`, "--saleor-version", version)}`,
          }
        )
      )
    : Effect.void;

export const requireVersionFormat = (version: string | undefined) =>
  version === undefined || VERSION_PATTERN.test(version)
    ? Effect.void
    : Effect.fail(
        fail("USAGE_ERROR", "Pass a complete Saleor version, such as 3.23.41.")
      );

// An instance whose first setup never finished has no data worth keeping, so it takes
// the options of this run (a wrong --saleor-version is fixed by re-running). A set-up
// instance keeps its version; sample data can be added to it but never removed.
const reuseConfig = (
  existing: LocalConfig,
  version: string | undefined,
  sampleData: boolean
) =>
  Effect.gen(function* () {
    if (!existing.initialized) {
      const config: LocalConfig = {
        ...existing,
        saleorVersion: version ?? existing.saleorVersion,
        sampleData: sampleData || existing.sampleData,
      };

      yield* saveConfig(config);

      return { changed: true, config, created: false };
    }

    yield* requireCompatible(existing, version);

    if (sampleData && !existing.sampleData) {
      const config: LocalConfig = { ...existing, sampleData: true };

      yield* saveConfig(config);

      return { changed: true, config, created: false };
    }

    return { changed: false, config: existing, created: false };
  });

export const ensureConfig = (
  name: string,
  version: string | undefined,
  sampleData: boolean
) =>
  Effect.gen(function* () {
    yield* localName(name);

    yield* requireVersionFormat(version);

    const existing = yield* readConfig(name);

    if (existing) {
      return yield* reuseConfig(existing, version, sampleData);
    }

    const [apiPort = 0, dashboardPort = 0, mailPort = 0] = yield* freePorts(3);

    const config: LocalConfig = {
      apiPort,
      dashboardPort,
      initialized: false,
      mailPort,
      name,
      saleorVersion: version ?? SALEOR_VERSION,
      sampleData,
    };

    yield* saveConfig(config);

    return { changed: true, config, created: true };
  });

// Instances created before the mail UI was published get a port on their next `up`.
export const withMailPort = (config: LocalConfig) =>
  Effect.gen(function* () {
    if (config.mailPort !== undefined) {
      return config;
    }

    const [mailPort] = yield* freePorts(1, [
      config.apiPort,
      config.dashboardPort,
    ]);

    const updated: LocalConfig = { ...config, mailPort };
    yield* saveConfig(updated);

    return updated;
  });

// Whether something else is listening on a port this instance publishes. Only
// meaningful while the instance's own containers are stopped.
export const portInUse = (port: number) =>
  Effect.promise(
    () =>
      new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", () => resolve(true));
        server.listen(port, "127.0.0.1", () => {
          server.close(() => resolve(false));
        });
      })
  );

// Every local instance with saved state, by name.
export const listInstanceNames = () =>
  Effect.sync(() => {
    const dir = localsDir();

    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          NAME_PATTERN.test(entry.name) &&
          existsSync(path.join(dir, entry.name, "instance.json"))
      )
      .map((entry) => entry.name)
      .sort();
  });

export const adminEmail = "admin@example.com";
export const secretKey = (name: string) => `local:${name}`;

const SecretsSchema = Schema.Struct({
  database: Schema.String,
  django: Schema.String,
  password: Schema.String,
});

type LocalSecrets = typeof SecretsSchema.Type;

const parseSecrets = (raw: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(SecretsSchema))(raw).pipe(
    Effect.mapError(() =>
      fail("LOCAL_STATE_ERROR", "The saved local credentials are unreadable.")
    )
  );

// The saved admin password of an instance, if it has one.
export const prepareSecrets = (config: LocalConfig) =>
  Effect.gen(function* () {
    const store = yield* SecretStore;
    const key = secretKey(config.name);
    const existing = yield* store.get(key);

    const secrets: LocalSecrets = existing
      ? yield* parseSecrets(existing)
      : {
          database: randomBytes(24).toString("hex"),
          django: randomBytes(48).toString("hex"),
          password: randomBytes(24).toString("hex"),
        };

    if (!existing) {
      yield* store.set(key, JSON.stringify(secrets));
    }

    yield* Effect.try({
      catch: () =>
        fail(
          "LOCAL_STATE_ERROR",
          "Could not write the private Docker environment files."
        ),
      try: () => {
        writeFileSync(
          path.join(instanceDir(config.name), ".env"),
          `DATABASE_PASSWORD=${secrets.database}\n`,
          { mode: 0o600 }
        );
        writeFileSync(
          path.join(instanceDir(config.name), "backend.env"),
          `${[
            `DATABASE_URL=postgres://saleor:${secrets.database}@db/saleor`,
            `SECRET_KEY=${secrets.django}`,
            `DJANGO_SUPERUSER_EMAIL=${adminEmail}`,
            `DJANGO_SUPERUSER_PASSWORD=${secrets.password}`,
            "CACHE_URL=redis://cache:6379/0",
            "CELERY_BROKER_URL=redis://cache:6379/1",
            "EMAIL_URL=smtp://mailpit:1025",
            "DEFAULT_FROM_EMAIL=noreply@example.com",
            "ALLOWED_HOSTS=localhost,127.0.0.1,api",
            `DASHBOARD_URL=http://localhost:${config.dashboardPort}/`,
            "DEFAULT_CHANNEL_SLUG=default-channel",
            "HTTP_IP_FILTER_ALLOW_LOOPBACK_IPS=True",
            "OTEL_TRACES_EXPORTER=none",
            "OTEL_METRICS_EXPORTER=none",
          ].join("\n")}\n`,
          { mode: 0o600 }
        );
      },
    });

    return secrets;
  });
