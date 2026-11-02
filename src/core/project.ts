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
import { configDir } from "./secret-store.ts";

// A project is a folder holding what a store is made of: `saleor.yml` names the stores
// it works with ("environments"), next to `config.yml` and maybe a storefront. Commands
// run anywhere inside it find it by walking up, like git does.
//
//   # saleor.yml
//   name: outdoor-shop
//   config: config.yml
//   environments:
//     local: local:outdoor-shop
//     staging: cloud:acme/abc123
//
// It holds names and refs only, never credentials, so it is committed.

export const MANIFEST = "saleor.yml";

export interface LocalDefinition {
  readonly configure?: "on-create" | "never" | undefined;
  readonly kind: "local";
  readonly saleor: string;
}

export interface Project {
  readonly config: string;
  readonly definitions?: Readonly<Record<string, string | LocalDefinition>>;
  // The environments in the order they were added; the first is the default.
  readonly environments: readonly (readonly [name: string, ref: string])[];
  readonly name: string;
  readonly root: string;
  readonly storefront?: string | undefined;
}

const UNSAFE = /[^a-z0-9-]+/g;

export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(UNSAFE, "-")
    .replaceAll(/^-+|-+$/g, "") || "saleor";

const ManifestSchema = Schema.Struct({
  config: Schema.optional(Schema.String),
  environments: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([
        Schema.String,
        Schema.Struct({
          configure: Schema.optional(Schema.Literals(["on-create", "never"])),
          kind: Schema.Literal("local"),
          saleor: Schema.String,
        }),
      ])
    )
  ),
  name: Schema.optional(Schema.String),
  storefront: Schema.optional(Schema.Struct({ path: Schema.String })),
});

// YAML text through a schema; none when either rejects it.
const decodeYaml = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  text: string
): Option.Option<S["Type"]> => {
  try {
    return Schema.decodeUnknownOption(schema)(parseDocument(text).toJS());
  } catch {
    return Option.none();
  }
};

const read = (root: string): Project => {
  const fields = Option.getOrElse(
    decodeYaml(
      ManifestSchema,
      readFileSync(path.join(root, MANIFEST), "utf-8")
    ),
    () => {
      throw fail(
        "CONFIG_INVALID",
        `Invalid project manifest at ${path.join(root, MANIFEST)}.`
      );
    }
  );

  return {
    config: fields.config ?? "config.yml",
    definitions: fields.environments ?? {},
    environments: Object.entries(fields.environments ?? {}).map(
      ([name, value]) =>
        [
          name,
          Predicate.isString(value)
            ? value
            : `local:${bindingName(root, name)}`,
        ] as const
    ),
    name: fields.name ?? path.basename(root),
    root,
    storefront: fields.storefront?.path,
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
    existsSync(file) ? readFileSync(file, "utf-8") : "{}"
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

// ── What was last deployed ───────────────────────────────────────────────
// Kept per user, not in the project: it describes this computer's last runs.

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
export const recordInSync = (file: string, ref: string) =>
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

export interface SyncNote {
  readonly at: Date;
  readonly edited: boolean;
}

// Whether `file` changed since `ref` last matched it, by this computer's records.
export const lastInSync = (
  file: string,
  ref: string
): Option.Option<SyncNote> => {
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

// The channel a storefront in this project should show: the configuration's first
// channel other than Saleor's default, when there is a configuration.
const ChannelsSchema = Schema.Struct({
  channels: Schema.optional(
    Schema.Array(Schema.Struct({ slug: Schema.optional(Schema.String) }))
  ),
});

export const projectChannel = (root: string): Option.Option<string> =>
  Option.flatMap(projectAt(root), (project) => {
    if (!existsSync(configPath(project))) {
      return Option.none();
    }

    return Option.flatMap(
      decodeYaml(ChannelsSchema, readFileSync(configPath(project), "utf-8")),
      (config) => {
        const slugs = (config.channels ?? []).flatMap((channel) =>
          channel.slug === undefined ? [] : [channel.slug]
        );

        return Option.fromUndefinedOr(
          slugs.find((slug) => slug !== "default-channel") ?? slugs[0]
        );
      }
    );
  });

// Conventional component paths are relative to the project, even from a nested cwd.
// Explicit paths remain relative to the caller.
export const storefrontFolder = (
  explicit: Option.Option<string>,
  standalone: string
): string =>
  Option.match(explicit, {
    onNone: () =>
      Option.match(findProject(), {
        onNone: () => path.resolve(standalone),
        onSome: (project) =>
          path.resolve(project.root, project.storefront ?? "storefront"),
      }),
    onSome: (dir) => path.resolve(dir),
  });

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

// Files already warned about, so a command that reads the project twice warns once.
const unreadable = new Set<string>();

export const bindingName = (root: string, alias: string): string => {
  const file = bindingFile(root, alias);

  if (existsSync(file)) {
    const binding = decodeBinding(readFileSync(file, "utf-8"));

    if (Option.isSome(binding)) {
      return binding.value.name;
    }

    // A damaged binding must not break every command in the project: fall back to
    // the default name and say so, since it may point at a different local store.
    if (!unreadable.has(file)) {
      unreadable.add(file);
      process.stderr.write(
        `Ignoring unreadable file ${file}; the "${alias}" environment uses the default local store name. Delete the file to stop this warning.\n`
      );
    }
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

export const projectLocal = () =>
  Option.flatMap(findProject(), (project) => {
    const locals = Object.entries(project.definitions ?? {}).filter(
      (candidate): candidate is [string, LocalDefinition] =>
        !Predicate.isString(candidate[1])
    );

    const entry =
      locals.find(([name]) => name === "local") ??
      (locals.length === 1 ? locals[0] : undefined);

    return entry === undefined
      ? Option.none()
      : Option.some({
          alias: entry[0],
          definition: entry[1],
          name: bindingName(project.root, entry[0]),
          project,
        });
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
              configure: "on-create",
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
      "# Saleor project\n\nsaleor.yml defines environments; config.yml describes store configuration.\nThe optional storefront/ and apps/* directories contain services connected to those environments.\nRun saleor local up to prepare this checkout's local environment.\nBefore changing a store, select its environment and inspect saleor config diff <environment>.\nKeep credentials in the CLI secret store or ignored environment files.\nUse saleor --help for workflows and follow component-specific instructions when editing a component.\n",
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
