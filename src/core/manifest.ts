import { Option, Predicate, Schema } from "effect";
import { parseDocument } from "yaml";
import { fail } from "./errors.ts";

// The format of `saleor.yml`, the committed file that makes a folder a project:
//
//   name: outdoor-shop
//   environments:
//     local: { kind: local, saleor: "3.23.41" }
//     staging: cloud:acme/abc123
//   components:
//     storefront:
//       kind: storefront
//       config: config/saleor/storefront-content.config.yml
//
// Every key is there because a command reads it, and a key with a default is written
// only when it differs from it: `config` (config.yml), a component's `path` (its
// name), a local environment's `configure` (on-create), `version` (1).
//
// It holds names, paths and refs only, never credentials. It says where things are,
// not how they are built: a component's packages, scripts and lockfile are its own,
// so a project works in any repository layout.

export const MANIFEST = "saleor.yml";

// The format this CLI reads. A manifest without `version` is 1; a later format will
// say its version, so this CLI can refuse it instead of misreading it.
export const MANIFEST_VERSION = 1;

export interface LocalDefinition {
  // Whether a new instance gets the project's configuration: on-create unless never.
  readonly configure?: "on-create" | "never" | undefined;
  readonly kind: "local";
  readonly saleor: string;
}

export const configuresOnCreate = (definition: LocalDefinition) =>
  definition.configure !== "never";

// Something in the project that connects to its stores: a storefront, later an app.
// `kind` names the module that owns it. Which store it is connected to is not here:
// that is each checkout's choice, kept in the component's own ignored files.
export interface Component {
  // A configuration file of its own, relative to the component, deployed after the
  // project's (config deploy).
  readonly config?: string | undefined;
  readonly kind: string;
  readonly name: string;
  // Relative to the project root, with forward slashes. In saleor.yml, only when it
  // is not the component's name.
  readonly path: string;
}

const LocalDefinitionSchema = Schema.Struct({
  configure: Schema.optional(Schema.Literals(["on-create", "never"])),
  kind: Schema.Literal("local"),
  saleor: Schema.String,
});

const ComponentSchema = Schema.Struct({
  config: Schema.optional(Schema.String),
  kind: Schema.String,
  path: Schema.optional(Schema.String),
});

const ManifestSchema = Schema.Struct({
  components: Schema.optional(Schema.Record(Schema.String, ComponentSchema)),
  config: Schema.optional(Schema.String),
  environments: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Union([Schema.String, LocalDefinitionSchema])
    )
  ),
  name: Schema.optional(Schema.String),
  // Before `components`: the storefront's folder. Still read; the next time a
  // component is recorded, it moves to `components`.
  storefront: Schema.optional(Schema.Struct({ path: Schema.String })),
  version: Schema.optional(Schema.Int),
});

export type ManifestFields = typeof ManifestSchema.Type;

// The same schema refusing keys it does not know, to find misspelled ones: decoding
// otherwise drops them silently, and the CLI falls back to defaults.
const strict = Schema.toStandardSchemaV1(ManifestSchema, {
  parseOptions: { errors: "all", onExcessProperty: "error" },
});

// Warnings already given, so a command that reads the project twice warns once.
const warned = new Set<string>();

export const warnOnce = (key: string, message: string) => {
  if (!warned.has(key)) {
    warned.add(key);
    process.stderr.write(`${message}\n`);
  }
};

// The manifest in `file`, whose text is `text`. Fails on a manifest that is not one,
// or is newer than this CLI; warns about keys it does not know.
export const decodeManifest = (file: string, text: string): ManifestFields => {
  let raw: unknown;

  try {
    raw = parseDocument(text).toJS();
  } catch {
    raw = undefined;
  }

  const fields = Option.getOrElse(
    Schema.decodeUnknownOption(ManifestSchema)(raw),
    () => {
      throw fail("CONFIG_INVALID", `Invalid project manifest at ${file}.`);
    }
  );

  if (fields.version !== undefined && fields.version > MANIFEST_VERSION) {
    throw fail(
      "CONFIG_INVALID",
      `${file} is version ${fields.version}; this CLI reads version ${MANIFEST_VERSION}.`,
      { suggestion: "Update the Saleor CLI." }
    );
  }

  const checked = strict["~standard"].validate(raw);

  const unknown =
    checked instanceof Promise || checked.issues === undefined
      ? []
      : checked.issues.map((issue) =>
          (issue.path ?? [])
            .map((segment) =>
              String(Predicate.isObject(segment) ? segment.key : segment)
            )
            .join(".")
        );

  if (unknown.length > 0) {
    warnOnce(
      `${file}\0${unknown.join("\0")}`,
      `Ignoring unknown key${unknown.length > 1 ? "s" : ""} in ${file}: ${unknown.join(", ")}. Check the spelling.`
    );
  }

  return fields;
};

// The components listed, with the old `storefront: { path }` as one when no
// storefront is listed under `components`.
export const componentsOf = (fields: ManifestFields): readonly Component[] => {
  const listed = Object.entries(fields.components ?? {}).map(
    ([name, component]) => ({
      config: component.config,
      kind: component.kind,
      name,
      path: component.path ?? name,
    })
  );

  const legacy = fields.storefront?.path;

  return legacy === undefined || listed.some((c) => c.kind === "storefront")
    ? listed
    : [{ kind: "storefront", name: "storefront", path: legacy }, ...listed];
};
