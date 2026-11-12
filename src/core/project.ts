import { Effect, Option, Predicate } from "effect";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type Document, parseDocument } from "yaml";
import { bindingName, saveBinding } from "./bindings.ts";
import { fail } from "./errors.ts";
import {
  type Component,
  componentsOf,
  decodeManifest,
  type LocalDefinition,
  MANIFEST,
} from "./manifest.ts";
import { freeName, slugify } from "./names.ts";
import { localRef } from "./ref.ts";
import type { Store } from "./store.ts";

// A project is a folder holding what a store is made of: `saleor.yml` (see
// manifest.ts) names the stores it works with (its environments), the store's
// configuration, and the components that connect to those stores, such as a
// storefront. Commands run anywhere inside it find it by walking up, like git does.

export { MANIFEST } from "./manifest.ts";

export type { Component, LocalDefinition } from "./manifest.ts";

export interface Project {
  readonly components: readonly Component[];
  readonly config: string;
  // What saleor.yml says for each environment: a ref, or a local definition.
  readonly definitions: Readonly<Record<string, string | LocalDefinition>>;
  // Each environment's name and the ref of its store, in the order they were added.
  // None is a default: a command takes the only one without asking, and otherwise
  // asks or needs one named.
  readonly environments: readonly (readonly [name: string, ref: string])[];
  readonly name: string;
  readonly root: string;
}

const read = (root: string): Project => {
  const file = path.join(root, MANIFEST);
  const fields = decodeManifest(file, readFileSync(file, "utf-8"));
  const definitions = fields.environments ?? {};

  return {
    components: componentsOf(fields),
    config: fields.config ?? "config.yml",
    definitions,
    environments: Object.entries(definitions).map(
      ([name, value]) =>
        [
          name,
          Predicate.isString(value) ? value : localRef(bindingName(root, name)),
        ] as const
    ),
    name: fields.name ?? path.basename(root),
    root,
  };
};

// The project the current directory is in, if any.
export const findProject = (from = process.cwd()): Option.Option<Project> => {
  let dir = path.resolve(from);

  for (;;) {
    if (existsSync(path.join(dir, MANIFEST))) {
      return Option.some(read(dir));
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      return Option.none();
    }

    dir = parent;
  }
};

export const projectAt = (root: string): Option.Option<Project> =>
  existsSync(path.join(root, MANIFEST))
    ? Option.some(read(root))
    : Option.none();

export const configPath = (project: Project) =>
  path.join(project.root, project.config);

// Changes saleor.yml in place, keeping its comments and order; creates it when
// `create` gives its first content.
export const editManifest = (
  root: string,
  edit: (document: Document) => void,
  create?: { readonly name: string }
) =>
  Effect.try({
    catch: () =>
      fail(
        "LOCAL_STATE_ERROR",
        `Could not write ${path.join(root, MANIFEST)}.`
      ),
    try: () => {
      const file = path.join(root, MANIFEST);
      const exists = existsSync(file);
      const document = parseDocument(exists ? readFileSync(file, "utf-8") : "");

      if (!exists) {
        if (create === undefined) {
          throw new Error(`No ${MANIFEST} in ${root}`);
        }

        mkdirSync(root, { recursive: true });
        document.set("name", create.name);
      }

      edit(document);
      writeFileSync(file, document.toString());
    },
  });

type NewStore = Pick<Store, "kind" | "name" | "ref" | "saleorVersion">;

// Whether a store is named in saleor.yml as a local definition, which every
// checkout creates its own store from, rather than by its ref.
const isLocalDefinition = (
  store: NewStore
): store is NewStore & { readonly saleorVersion: string } =>
  store.kind === "local" && store.saleorVersion !== null;

// Names `store` as `environment` in saleor.yml: a local store as a definition with
// this checkout's store bound to it, any other by its ref.
const nameStore =
  (root: string, environment: string, store: NewStore) =>
  (document: Document) => {
    if (isLocalDefinition(store)) {
      saveBinding(root, environment, store.name);
      document.setIn(["environments", environment], {
        kind: "local",
        saleor: store.saleorVersion,
      });

      return;
    }

    document.setIn(["environments", environment], store.ref);
  };

// Creates the manifest, or adds an environment to it for a store it does not name
// yet. A store already listed keeps its name; a taken name gets a suffix. Returns
// the name the store is known by.
export const rememberEnvironment = ({
  root,
  wanted,
  ref,
  defaults = {},
}: {
  readonly root: string;
  readonly wanted: string;
  readonly ref: string;
  readonly defaults?: { readonly name?: string };
}) =>
  Effect.gen(function* () {
    const environments = Option.match(projectAt(root), {
      onNone: () => [],
      onSome: (project) => project.environments,
    });

    const known = environments.find(([, each]) => each === ref);

    if (known !== undefined) {
      return { added: false, name: known[0] };
    }

    const name = freeName(
      environments.map(([each]) => each),
      wanted
    );

    yield* editManifest(
      root,
      (document) => {
        document.setIn(["environments", name], ref);
      },
      { name: defaults.name ?? path.basename(root) }
    );

    return { added: true, name };
  });

// The folder `init` makes a project in: here when here is empty or already a
// project, else a folder named after the store next to what is here. The storefront
// extension uses the same rule, so both land in the same folder.
export const projectFolder = (name: string) => {
  const existing = findProject();

  if (Option.isSome(existing)) {
    return existing.value.root;
  }

  const here = process.cwd();
  const named = path.join(here, slugify(name));

  if (
    existsSync(path.join(here, MANIFEST)) ||
    existsSync(path.join(here, "storefront", "package.json"))
  ) {
    return here;
  }

  if (existsSync(named)) {
    return named;
  }

  const used = readdirSync(here).some((entry) => !entry.startsWith("."));

  return used ? named : here;
};

type LocalEntry = readonly [environment: string, definition: LocalDefinition];

const localEntries = (project: Project): readonly LocalEntry[] =>
  Object.entries(project.definitions).filter(
    (candidate): candidate is [string, LocalDefinition] =>
      !Predicate.isString(candidate[1])
  );

const localContext = (
  project: Project,
  [environment, definition]: LocalEntry
) => ({
  definition,
  environment,
  name: bindingName(project.root, environment),
  project,
});

// The project's local environment, for `init --local` inside a project: the one
// named "local", else the only one.
export const projectLocal = () =>
  Option.flatMap(findProject(), (project) => {
    const locals = localEntries(project);

    const entry =
      locals.find(([name]) => name === "local") ??
      (locals.length === 1 ? locals[0] : undefined);

    return entry === undefined
      ? Option.none()
      : Option.some(localContext(project, entry));
  });

// The local environment saleor.yml defines for this local store, if any: what
// `env start` creates it from.
export const projectLocalOf = (name: string) =>
  Option.flatMap(findProject(), (project) => {
    const entry = localEntries(project).find(
      ([environment]) => bindingName(project.root, environment) === name
    );

    return entry === undefined
      ? Option.none()
      : Option.some(localContext(project, entry));
  });

// `env add`: names a store in saleor.yml.
export const addEnvironment = (
  root: string,
  environment: string,
  store: NewStore
) => editManifest(root, nameStore(root, environment, store));

// After `env remove`: a name for a store that no longer exists goes too. A local
// definition stays, since it is a recipe every checkout creates its own store
// from, not one store. Returns whether saleor.yml changed.
export const forgetEnvironment = (root: string, environment: string) =>
  Effect.gen(function* () {
    const value = Option.match(projectAt(root), {
      onNone: () => undefined,
      onSome: (project) => project.definitions[environment],
    });

    if (!Predicate.isString(value)) {
      return false;
    }

    yield* editManifest(root, (document) => {
      document.deleteIn(["environments", environment]);
    });

    return true;
  });

// After `init` made a store for a project: names it, unless saleor.yml already does.
// A local store is named "local" (or by the environment that already has its ref)
// and saved as a definition, unless one is there already.
export const nameFirstStore = (root: string, name: string, store: NewStore) =>
  Effect.gen(function* () {
    const { name: environment } = yield* rememberEnvironment({
      defaults: { name },
      ref: store.ref,
      root,
      wanted: store.kind === "local" ? "local" : store.name,
    });

    if (!isLocalDefinition(store)) {
      return;
    }

    const project = read(root);

    if (Predicate.isObject(project.definitions[environment])) {
      saveBinding(root, environment, store.name);

      return;
    }

    yield* editManifest(root, nameStore(root, environment, store));
  });
