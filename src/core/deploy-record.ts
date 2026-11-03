import { Effect, Option, Schema } from "effect";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDir } from "./secret-store.ts";

// What was last deployed from this computer, per configuration file and store. Kept
// per user, not in the project: it describes this computer's last runs.

const stateFile = () => path.join(configDir(), "projects.json");

const DeploymentsSchema = Schema.Record(
  Schema.String,
  Schema.Record(
    Schema.String,
    Schema.Struct({ at: Schema.String, hash: Schema.String })
  )
);

type Deployments = typeof DeploymentsSchema.Type;

const readState = (): Deployments => {
  try {
    return Option.getOrElse(
      Schema.decodeUnknownOption(Schema.fromJsonString(DeploymentsSchema))(
        readFileSync(stateFile(), "utf-8")
      ),
      () => ({})
    );
  } catch {
    return {};
  }
};

export const fileHash = (file: string) =>
  existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : null;

// Records that the store `ref` matched `file` as it is now.
export const recordDeploy = (file: string, ref: string) =>
  Effect.sync(() => {
    const hash = fileHash(file);

    if (hash === null) {
      return;
    }

    const state = readState();
    const key = path.resolve(file);

    const next: Deployments = {
      ...state,
      [key]: { ...state[key], [ref]: { at: new Date().toISOString(), hash } },
    };

    mkdirSync(path.dirname(stateFile()), { recursive: true });
    writeFileSync(stateFile(), `${JSON.stringify(next, null, 2)}\n`);
  });

export interface DeployRecord {
  readonly at: Date;
  readonly edited: boolean;
}

// Whether `file` changed since `ref` last matched it, by this computer's records.
export const lastDeploy = (
  file: string,
  ref: string
): Option.Option<DeployRecord> => {
  const entry = readState()[path.resolve(file)]?.[ref];

  return entry === undefined
    ? Option.none()
    : Option.some({
        at: new Date(entry.at),
        edited: fileHash(file) !== entry.hash,
      });
};

export const ago = (date: Date, now = Date.now()) => {
  const minutes = Math.round((now - date.getTime()) / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};
