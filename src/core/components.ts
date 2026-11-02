import { Effect, Option, Predicate, Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import type { Component } from "./manifest.ts";
import {
  configPath,
  editManifest,
  findProject,
  type Project,
  projectAt,
  slugify,
} from "./project.ts";

// The components saleor.yml lists (see manifest.ts): where they are, and the
// configuration files they bring.

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

// Where the project's storefront is, relative to the root: the first storefront
// component, else the conventional folder.
export const storefrontPath = (project: Project) =>
  project.components.find((each) => each.kind === "storefront")?.path ??
  "storefront";

export interface ConfigFile {
  // The component it belongs to; none for the project's own configuration.
  readonly component: string | undefined;
  readonly file: string;
}

// Every configuration file the project deploys, in the order they are deployed: the
// project's own first, since a component's content can build on it, then each
// component's.
export const configFiles = (project: Project): readonly ConfigFile[] => [
  { component: undefined, file: configPath(project) },
  ...project.components.flatMap((each) =>
    each.config === undefined
      ? []
      : [
          {
            component: each.name,
            file: path.resolve(project.root, each.path, each.config),
          },
        ]
  ),
];

const portable = (relative: string) => relative.split(path.sep).join("/");

// A name from the folder, with a suffix when another component has it.
const freeName = (components: readonly Component[], folder: string) => {
  const taken = new Set(components.map((each) => each.name));
  const base = slugify(folder);
  let name = base;

  for (let n = 2; taken.has(name); n += 1) {
    name = `${base}-${n}`;
  }

  return name;
};

// Records a component in the project's saleor.yml: under the name it already has
// when one is listed at the same path, else a name from its folder. A folder outside
// the project, or a folder with no project, is not recorded. Returns the name.
export const recordComponent = (
  dir: string,
  component: Pick<Component, "config" | "kind">
) =>
  Effect.gen(function* () {
    const project = findProject(dir);

    if (Option.isNone(project)) {
      return Option.none<string>();
    }

    const { root, components } = project.value;
    const relative = portable(path.relative(root, path.resolve(dir)));

    if (relative === "" || relative.startsWith("..")) {
      return Option.none<string>();
    }

    const existing = components.find((each) => each.path === relative);

    const name =
      existing?.name ?? freeName(components, path.basename(relative));

    // A configuration not found this time stays as recorded.
    const config = component.config ?? existing?.config;

    yield* editManifest(root, (document) => {
      // The old `storefront: { path }` key becomes the component it names.
      const legacy: unknown = document.getIn(["storefront", "path"]);

      if (Predicate.isString(legacy)) {
        if (!document.hasIn(["components", "storefront"])) {
          document.setIn(["components", "storefront", "kind"], "storefront");

          if (legacy !== "storefront") {
            document.setIn(["components", "storefront", "path"], legacy);
          }
        }

        document.delete("storefront");
      }

      // Written key by key, so a key without a value is left out.
      if (document.hasIn(["components", name])) {
        document.deleteIn(["components", name]);
      }

      document.setIn(["components", name, "kind"], component.kind);

      // A component's folder is its name unless saleor.yml says otherwise.
      if (relative !== name) {
        document.setIn(["components", name, "path"], relative);
      }

      if (config !== undefined) {
        document.setIn(["components", name, "config"], config);
      }
    });

    return Option.some(name);
  });

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
          path.resolve(project.root, storefrontPath(project)),
      }),
    onSome: (dir) => path.resolve(dir),
  });
