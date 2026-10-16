import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Entry } from "@napi-rs/keyring";
import { Context, Effect, Layer, Schema } from "effect";

// Per-user secret storage: the system keyring (macOS Keychain, Secret Service, Windows
// Credential Manager) with a 0600 file fallback for machines without one, such as CI
// containers. Secrets are identity, not project context, so nothing here is stored in
// the project directory.
export interface SecretStoreService {
  readonly backend: "keyring" | "file";
  readonly get: (key: string) => Effect.Effect<string | undefined>;
  readonly remove: (key: string) => Effect.Effect<void>;
  readonly set: (key: string, value: string) => Effect.Effect<void>;
}

export class SecretStore extends Context.Service<
  SecretStore,
  SecretStoreService
>()("saleor/SecretStore") {}

const KEYRING_SERVICE = "saleor-cli";

export const configDir = (env: NodeJS.ProcessEnv = process.env) =>
  env.SALEOR_CONFIG_DIR ??
  path.join(
    env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "saleor"
  );

const fileStore = (dir: string): SecretStoreService => {
  const file = path.join(dir, "credentials.json");

  const read = (): Record<string, string> =>
    existsSync(file)
      ? Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
          JSON.parse(readFileSync(file, "utf8"))
        )
      : {};

  const write = (data: Record<string, string>) => {
    mkdirSync(dir, { mode: 0o700, recursive: true });

    if (Object.keys(data).length === 0) {
      return rmSync(file, { force: true });
    }

    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  };

  return {
    backend: "file",
    get: (key) => Effect.sync(() => read()[key]),
    remove: (key) =>
      Effect.sync(() => {
        const { [key]: _, ...rest } = read();
        write(rest);
      }),
    set: (key, value) => Effect.sync(() => write({ ...read(), [key]: value })),
  };
};

const keyringStore = (): SecretStoreService => ({
  backend: "keyring",
  get: (key) =>
    Effect.sync(
      () => new Entry(KEYRING_SERVICE, key).getPassword() ?? undefined
    ),
  remove: (key) =>
    Effect.sync(() => {
      try {
        new Entry(KEYRING_SERVICE, key).deletePassword();
      } catch {
        // Already absent.
      }
    }),
  set: (key, value) =>
    Effect.sync(() => new Entry(KEYRING_SERVICE, key).setPassword(value)),
});

const keyringWorks = (): boolean => {
  try {
    new Entry(KEYRING_SERVICE, "probe").getPassword();

    return true;
  } catch {
    return false;
  }
};

export const makeSecretStore = (
  env: NodeJS.ProcessEnv = process.env
): SecretStoreService => {
  const preference = env.SALEOR_CREDENTIAL_STORE;

  if (preference === "file") {
    return fileStore(configDir(env));
  }

  return keyringWorks() ? keyringStore() : fileStore(configDir(env));
};

export const SecretStoreLive = Layer.sync(SecretStore, () => makeSecretStore());
