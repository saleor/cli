import { Entry } from "@napi-rs/keyring";
import { Context, Effect, Layer, Schema } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

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
          JSON.parse(readFileSync(file, "utf-8"))
        )
      : {};

  const write = (data: Record<string, string>) => {
    mkdirSync(dir, { mode: 0o700, recursive: true });

    if (Object.keys(data).length === 0) {
      rmSync(file, { force: true });

      return;
    }

    // Write a private temp file and rename it over the old one, so a crash or a
    // concurrent CLI process never sees a half-written credentials file.
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  };

  return {
    backend: "file",
    get: (key) => Effect.sync(() => read()[key]),
    remove: (key) =>
      Effect.sync(() => {
        if (!existsSync(file)) {
          return;
        }

        const { [key]: _, ...rest } = read();
        write(rest);
      }),
    set: (key, value) =>
      Effect.sync(() => {
        write({ ...read(), [key]: value });
      }),
  };
};

const succeeded = (action: () => void) => {
  try {
    action();

    return true;
  } catch {
    return false;
  }
};

// The keyring is preferred, but some platforms can read it and still refuse writes
// (locked Secret Service, headless sessions). Such writes land in the file instead, and
// reads look in both places, so a login is never lost to a keyring that half works.
const keyringStore = (fallback: SecretStoreService): SecretStoreService => {
  const entry = (key: string) => new Entry(KEYRING_SERVICE, key);

  return {
    backend: "keyring",
    get: (key) =>
      Effect.sync(() => {
        let value: string | undefined;
        succeeded(() => {
          value = entry(key).getPassword() ?? undefined;
        });

        return value;
      }).pipe(
        Effect.filterOrElse(
          (value): value is string => value !== undefined,
          () => fallback.get(key)
        )
      ),
    remove: (key) =>
      Effect.andThen(
        Effect.sync(() => succeeded(() => entry(key).deletePassword())),
        fallback.remove(key)
      ),
    set: (key, value) =>
      Effect.flatMap(
        Effect.sync(() =>
          succeeded(() => {
            entry(key).setPassword(value);
          })
        ),
        (stored) => (stored ? fallback.remove(key) : fallback.set(key, value))
      ),
  };
};

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

  const file = fileStore(configDir(env));

  return keyringWorks() ? keyringStore(file) : file;
};

export const SecretStoreLive = Layer.sync(SecretStore, () => makeSecretStore());
