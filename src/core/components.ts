import { Effect, Option, Predicate } from "effect";
import path from "node:path";
import type { Component } from "./manifest.ts";
import {
  configPath,
  editManifest,
  findProject,
  type Project,
} from "./project.ts";
import { freeName } from "./names.ts";

// The components saleor.yml lists (see manifest.ts): where they are, and the
// configuration files they bring.

// Where the project's component of this kind is, relative to the root: the first one
// saleor.yml lists, else the conventional folder, named after the kind.
export const componentPath = (project: Project, kind: string) =>
  project.components.find((each) => each.kind === kind)?.path ?? kind;

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
      existing?.name ??
      freeName(
        components.map((each) => each.name),
        path.basename(relative)
      );

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

// Where a component of this kind is: the explicit folder, relative to the caller; else
// the project's, relative to its root, even from a nested folder; else `standalone`.
export const componentFolder = (
  explicit: Option.Option<string>,
  kind: string,
  standalone: string
): string =>
  Option.match(explicit, {
    onNone: () =>
      Option.match(findProject(), {
        onNone: () => path.resolve(standalone),
        onSome: (project) =>
          path.resolve(project.root, componentPath(project, kind)),
      }),
    onSome: (dir) => path.resolve(dir),
  });
