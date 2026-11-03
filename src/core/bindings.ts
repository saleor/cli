import { Option, Schema } from "effect";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { warnOnce } from "./output.ts";
import { configDir } from "./secret-store.ts";

// A local environment in saleor.yml is a definition every checkout creates its own
// store from. Which local store is this checkout's is its binding, kept under the
// user's CLI state (never in the project), keyed by the checkout's real path.

const bindingFile = (root: string, environment: string) =>
  path.join(
    configDir(),
    "workspaces",
    createHash("sha256").update(realpathSync(root)).digest("hex"),
    `${encodeURIComponent(environment)}.json`
  );

const decodeBinding = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String }))
);

// The name of this checkout's local store for `environment`: the one bound to it,
// else a name made from the checkout and the environment.
export const bindingName = (root: string, environment: string): string => {
  const file = bindingFile(root, environment);

  if (existsSync(file)) {
    const binding = decodeBinding(readFileSync(file, "utf-8"));

    if (Option.isSome(binding)) {
      return binding.value.name;
    }

    // A damaged binding must not break every command in the project: fall back to
    // the default name and say so, since it may point at a different local store.
    warnOnce(
      file,
      `Ignoring unreadable file ${file}; the "${environment}" environment uses the default local store name. Delete the file to stop this warning.`
    );
  }

  return `project-${createHash("sha256")
    .update(`${realpathSync(root)}\0${environment}`)
    .digest("hex")
    .slice(0, 20)}`;
};

export const saveBinding = (
  root: string,
  environment: string,
  name: string
) => {
  const file = bindingFile(root, environment);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ name }));
};

export const hasBinding = (root: string, environment: string) =>
  existsSync(bindingFile(root, environment));
