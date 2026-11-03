import { Effect, Option, Predicate, Schema } from "effect";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import { fail } from "./errors.ts";
import {
  type Component,
  componentsOf,
  decodeManifest,
  type LocalDefinition,
  MANIFEST,
  warnOnce,
} from "./manifest.ts";
import { configDir } from "./secret-store.ts";
import { localRef } from "./ref.ts";

// A project is a folder holding what a store is made of: `saleor.yml` (see
// manifest.ts) names the stores it works with ("environments"), the store's
// configuration, and the components that connect to those stores, such as a
// storefront. Commands run anywhere inside it find it by walking up, like git does.

export { MANIFEST } from "./manifest.ts";

export type { Component, LocalDefinition } from "./manifest.ts";

export interface Project {
  readonly components: readonly Component[];
  readonly config: string;
  readonly definitions?: Readonly<Record<string, string | LocalDefinition>>;
  // The environments in the order they were added. None is a default: a command
  // takes the only one without asking, and otherwise asks or needs one named.
  readonly environments: readonly (readonly [name: string, ref: string])[];
  readonly name: string;
  readonly root: string;
}

const UNSAFE = /[^a-z0-9-]+/g;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(UNSAFE, "-")
    .replaceAll(/^-+|-+$/g, "") || "saleor";

const read = (root: string): Project => {
  const file = path.join(root, MANIFEST);
  const fields = decodeManifest(file, readFileSync(file, "utf-8"));

  return {
    components: componentsOf(fields),
    config: fields.config ?? "config.yml",
    definitions: fields.environments ?? {},
    environments: Object.entries(fields.environments ?? {}).map(
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

const write = (project: Project) => {
  const file = path.join(project.root, MANIFEST);

  const document = parseDocument(
    existsSync(file) ? readFileSync(file, "utf-8") : ""
  );

  document.set("name", project.name);

  if (project.config !== "config.yml") {
    document.set("config", project.config);
  }

  const environments = {
    ...Object.fromEntries(project.environments),
    ...project.definitions,
  };

  for (const [alias, value] of Object.entries(environments)) {
    document.setIn(["environments", alias], value);
  }

  writeFileSync(file, document.toString());
};

// Creates the manifest, or adds an environment to it. A store already listed keeps
// its name; a taken name gets a suffix. Returns the name the store is known by.
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
  Effect.try({
    catch: () =>
      fail(
        "LOCAL_STATE_ERROR",
        `Could not write ${path.join(root, MANIFEST)}.`
      ),
    try: () => {
      mkdirSync(root, { recursive: true });

      const fresh: Project = {
        components: [],
        config: "config.yml",
        environments: [],
        name: defaults.name ?? path.basename(root),
        root,
      };

      const project = Option.getOrElse(projectAt(root), () => fresh);

      const known = project.environments.find(([, each]) => each === ref);

      if (known !== undefined) {
        return { added: false, name: known[0] };
      }

      const taken = new Set(project.environments.map(([each]) => each));
      const base = slugify(wanted);
      let name = base;

      for (let n = 2; taken.has(name); n += 1) {
        name = `${base}-${n}`;
      }

      write({
        ...project,
        environments: [...project.environments, [name, ref]],
      });

      return { added: true, name };
    },
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

// Bindings live under the user's CLI state, keyed by the canonical checkout path.
const bindingFile = (root: string, alias: string) =>
  path.join(
    configDir(),
    "workspaces",
    createHash("sha256").update(realpathSync(root)).digest("hex"),
    `${encodeURIComponent(alias)}.json`
  );

const decodeBinding = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ name: Schema.String }))
);

export const bindingName = (root: string, alias: string): string => {
  const file = bindingFile(root, alias);

  if (existsSync(file)) {
    const binding = decodeBinding(readFileSync(file, "utf-8"));

    if (Option.isSome(binding)) {
      return binding.value.name;
    }

    // A damaged binding must not break every command in the project: fall back to
    // the default name and say so, since it may point at a different local store.
    warnOnce(
      file,
      `Ignoring unreadable file ${file}; the "${alias}" environment uses the default local store name. Delete the file to stop this warning.`
    );
  }

  return `project-${createHash("sha256")
    .update(`${realpathSync(root)}\0${alias}`)
    .digest("hex")
    .slice(0, 20)}`;
};

export const saveBinding = (root: string, alias: string, name: string) => {
  const file = bindingFile(root, alias);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ name }));
};

type LocalEntry = readonly [alias: string, definition: LocalDefinition];

const localEntries = (project: Project): readonly LocalEntry[] =>
  Object.entries(project.definitions ?? {}).filter(
    (candidate): candidate is [string, LocalDefinition] =>
      !Predicate.isString(candidate[1])
  );

const localContext = (project: Project, [alias, definition]: LocalEntry) => ({
  alias,
  definition,
  name: bindingName(project.root, alias),
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

// The local environment saleor.yml defines for this instance, if any: what `env start`
// creates it from.
export const projectLocalOf = (name: string) =>
  Option.flatMap(findProject(), (project) => {
    const entry = localEntries(project).find(
      ([alias]) => bindingName(project.root, alias) === name
    );

    return entry === undefined
      ? Option.none()
      : Option.some(localContext(project, entry));
  });

export const editManifest = (
  root: string,
  edit: (document: ReturnType<typeof parseDocument>) => void
) =>
  Effect.try({
    catch: () =>
      fail(
        "LOCAL_STATE_ERROR",
        `Could not write ${path.join(root, MANIFEST)}.`
      ),
    try: () => {
      const file = path.join(root, MANIFEST);
      const document = parseDocument(readFileSync(file, "utf-8"));
      edit(document);
      writeFileSync(file, document.toString());
    },
  });

// `env add`: names a store in saleor.yml. A Cloud store is named by its ref; a local
// one by a definition every checkout creates its own store from, with this
// checkout's instance bound to it.
export const addEnvironment = (
  root: string,
  alias: string,
  store: {
    readonly kind: string;
    readonly name: string;
    readonly ref: string;
    readonly saleorVersion: string | null;
  }
) =>
  editManifest(root, (document) => {
    if (store.kind === "local" && store.saleorVersion !== null) {
      saveBinding(root, alias, store.name);
      document.setIn(["environments", alias], {
        kind: "local",
        saleor: store.saleorVersion,
      });

      return;
    }

    document.setIn(["environments", alias], store.ref);
  });

// After `env remove`: a name for a store that no longer exists goes too. A local
// definition stays, since it is a recipe every checkout creates its own instance
// from, not one store. Returns whether saleor.yml changed.
export const forgetEnvironment = (root: string, alias: string) =>
  Effect.gen(function* () {
    const value = Option.match(projectAt(root), {
      onNone: () => undefined,
      onSome: (project) => project.definitions?.[alias],
    });

    if (!Predicate.isString(value)) {
      return false;
    }

    yield* editManifest(root, (document) => {
      document.deleteIn(["environments", alias]);
    });

    return true;
  });

export const initializeProject = (
  root: string,
  name: string,
  store: {
    kind: string;
    ref: string;
    name: string;
    saleorVersion: string | null;
  }
) =>
  Effect.gen(function* () {
    yield* rememberEnvironment({
      root,
      wanted: store.kind === "local" ? "local" : store.name,
      ref: store.ref,
      defaults: { name },
    });
    yield* Effect.try({
      catch: () =>
        fail("LOCAL_STATE_ERROR", `Could not initialize project at ${root}.`),
      try: () => {
        const projectConfig = configPath(read(root));

        if (!existsSync(projectConfig)) {
          mkdirSync(path.dirname(projectConfig), { recursive: true });
          writeFileSync(projectConfig, "{}\n");
        }

        const file = path.join(root, MANIFEST);
        const document = parseDocument(readFileSync(file, "utf-8"));

        if (store.kind === "local" && store.saleorVersion !== null) {
          const project = read(root);

          const alias =
            project.environments.find(([, ref]) => ref === store.ref)?.[0] ??
            "local";

          saveBinding(root, alias, store.name);

          if (!Predicate.isObject(project.definitions?.[alias])) {
            document.setIn(["environments", alias], {
              kind: "local",
              saleor: store.saleorVersion,
            });
          }

          writeFileSync(file, document.toString());
        }

        writeProjectGuides(root);
      },
    });
  });

const writeProjectGuides = (root: string) => {
  const guides = {
    "AGENTS.md":
      "# Saleor project\n\nsaleor.yml defines environments and lists the project's components (a storefront, apps) with their paths; config.yml describes store configuration.\nEach component keeps its own packages, scripts and lockfile.\nCommands name an environment as the word after the command: saleor env start local, saleor config deploy staging.\nRun saleor env list to see every environment and its state.\nBefore changing a store, inspect saleor config diff <env>.\nKeep credentials in the CLI secret store or ignored environment files.\nUse saleor --help for workflows and follow component-specific instructions when editing a component.\n",
    "CLAUDE.md": "@AGENTS.md\n",
  };

  for (const [filename, content] of Object.entries(guides)) {
    const destination = path.join(root, filename);

    if (!existsSync(destination)) {
      writeFileSync(destination, content);
    }
  }

  const ignore = path.join(root, ".gitignore");
  const current = existsSync(ignore) ? readFileSync(ignore, "utf-8") : "";

  const missing = [".env", ".env.local", "node_modules/"].filter(
    (line) => !current.split("\n").includes(line)
  );

  if (missing.length) {
    writeFileSync(
      ignore,
      `${current}${current.endsWith("\n") || !current ? "" : "\n"}${missing.join("\n")}\n`
    );
  }
};

export const hasBinding = (root: string, alias: string) =>
  existsSync(bindingFile(root, alias));
