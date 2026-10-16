import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { Effect, Predicate, Schema } from "effect";
import { fail } from "../../core/errors.ts";
import { configDir, SecretStore } from "../../core/secret-store.ts";
import {
  composeTemplate,
  type LocalConfig,
  SALEOR_VERSION,
} from "./compose.ts";

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const localName = (name: string) =>
  NAME_PATTERN.test(name)
    ? Effect.succeed(name)
    : Effect.fail(
        fail(
          "USAGE_ERROR",
          "Local names must start with a lowercase letter and contain only lowercase letters, digits and hyphens (up to 40 characters)."
        )
      );

export const instanceDir = (name: string) =>
  path.join(configDir(), "local", name);

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
  name: Schema.String,
  saleorVersion: Schema.String,
  sampleData: Schema.Boolean,
});

export const readConfig = (name: string) =>
  Effect.try({
    catch: () =>
      fail(
        "USAGE_ERROR",
        `Local instance "${name}" has an unreadable configuration.`
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
      fail("TASK_FAILED", "Could not save the local instance configuration."),
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

export const ensureConfig = (
  name: string,
  version: string | undefined,
  sampleData: boolean
) =>
  Effect.gen(function* () {
    yield* localName(name);

    if (version !== undefined && !VERSION_PATTERN.test(version)) {
      return yield* fail(
        "USAGE_ERROR",
        "Pass a complete Saleor version, such as 3.23.41."
      );
    }

    const existing = yield* readConfig(name);

    if (existing) {
      if (
        (version && version !== existing.saleorVersion) ||
        (sampleData && !existing.sampleData)
      ) {
        return yield* fail(
          "USAGE_ERROR",
          `Local instance "${name}" already exists with different setup options.`,
          {
            suggestion:
              "Use another --name to create a separate instance. Existing data is kept.",
          }
        );
      }

      return { config: existing, created: false };
    }

    const apiPort = yield* availablePort();
    let dashboardPort = yield* availablePort();

    while (dashboardPort === apiPort) {
      dashboardPort = yield* availablePort();
    }

    const config: LocalConfig = {
      apiPort,
      dashboardPort,
      initialized: false,
      name,
      saleorVersion: version ?? SALEOR_VERSION,
      sampleData,
    };

    yield* saveConfig(config);

    return { config, created: true };
  });

export const adminEmail = "admin@example.com";
export const secretKey = (name: string) => `local:${name}`;

export const prepareSecrets = (config: LocalConfig) =>
  Effect.gen(function* () {
    const store = yield* SecretStore;
    const key = secretKey(config.name);
    const existing = yield* store.get(key);

    const secrets: { password: string; database: string; django: string } =
      existing
        ? JSON.parse(existing)
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
          "TASK_FAILED",
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
