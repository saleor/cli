import { Effect, Option } from "effect";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { result } from "../../core/command.ts";
import { recordComponent } from "../../core/components.ts";
import { fail } from "../../core/errors.ts";
import { columns, shown } from "../../core/output.ts";
import { slugify } from "../../core/names.ts";
import { findProject } from "../../core/project.ts";
import {
  type Downloaded,
  directoryState,
  downloadTemplate,
  finishCopy,
  template,
} from "../../core/scaffold.ts";

// An app of your own is saleor/saleor-app-template, downloaded as it is on `main`, in
// the project's apps/<name> folder, listed in saleor.yml as a component of kind
// "app". Each copy gets its own manifest id: Saleor installs one app per id, so two
// copies with the template's id could not both be on a store.

export const TEMPLATE = template(
  "saleor/saleor-app-template",
  "main",
  process.env.SALEOR_APP_TEMPLATE_URL
);

// Where the template declares its manifest, and the defaults each copy replaces.
const MANIFEST_SOURCE = "src/pages/api/manifest.ts";
const TEMPLATE_ID = 'id: "saleor.app"';
const TEMPLATE_NAME = 'name: "Saleor App Template"';

// The app SDK's FileAPL keeps each store's app token here (the template's comment
// says .auth-data.json, but the SDK writes this name).
const AUTH_DATA = ".saleor-app-auth.json";

const read = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf-8") : undefined;

export type Found =
  | { readonly kind: "absent" }
  | { readonly kind: "other" }
  | { readonly kind: "app"; readonly id: string | undefined };

const ID = /\bid:\s*"([^"]+)"/;

// An app from the template: a package on the app SDK with the template's manifest.
export const inspect = (dir: string): Found => {
  if (directoryState(dir) !== "used") {
    return { kind: "absent" };
  }

  const manifest = read(path.join(dir, MANIFEST_SOURCE));
  const pkg = read(path.join(dir, "package.json"));

  if (manifest === undefined || pkg?.includes("@saleor/app-sdk") !== true) {
    return { kind: "other" };
  }

  return { id: ID.exec(manifest)?.[1], kind: "app" };
};

// apps/<slug> in a project, else ./<slug>; --dir wins.
export const appFolder = (explicit: Option.Option<string>, slug: string) =>
  Option.match(explicit, {
    onNone: () =>
      Option.match(findProject(), {
        onNone: () => path.resolve(slug),
        onSome: (project) => path.resolve(project.root, "apps", slug),
      }),
    onSome: (dir) => path.resolve(dir),
  });

// Unique per project: <project>.<app>, so apps of two projects can share a store.
export const appIdentifier = (slug: string) =>
  `${Option.match(findProject(), {
    onNone: () => "app",
    onSome: (project) => slugify(project.name),
  })}.${slug}`;

const quoted = (text: string) => JSON.stringify(text);

// Gives the copy its id and name, and keeps its app tokens out of git. Each step
// warns when the template no longer looks as expected instead of failing.
// The template's .env.example sets its base URLs to nothing, meaning "the address the
// app is reached at"; but its manifest takes an empty value as the URL itself, so the
// manifest fails (HTTP 500). Commented out, they are unset and the fallback works.
const BASE_URLS = /^(APP_IFRAME_BASE_URL|APP_API_BASE_URL)=[ \t]*$/gm;

export const withoutEmptyBaseUrls = (example: string) =>
  example.replaceAll(BASE_URLS, "# $1=");

const personalize = (dir: string, name: string, identifier: string) =>
  Effect.try({
    catch: (error) =>
      fail(
        "LOCAL_STATE_ERROR",
        `Could not set up the app in ${shown(dir)}: ${error instanceof Error ? error.message : String(error)}`
      ),
    try: () => {
      const warnings: string[] = [];
      const source = path.join(dir, MANIFEST_SOURCE);
      const manifest = read(source) ?? "";

      if (manifest.includes(TEMPLATE_ID) && manifest.includes(TEMPLATE_NAME)) {
        writeFileSync(
          source,
          manifest
            .replace(TEMPLATE_ID, `id: ${quoted(identifier)}`)
            .replace(TEMPLATE_NAME, `name: ${quoted(name)}`)
        );
      } else {
        warnings.push(
          `The template's ${MANIFEST_SOURCE} no longer has the id and name the CLI sets; set the manifest's id to "${identifier}" yourself, so it is unique on a store.`
        );
      }

      const env = path.join(dir, ".env");
      const example = read(path.join(dir, ".env.example"));

      if (!existsSync(env) && example !== undefined) {
        writeFileSync(env, withoutEmptyBaseUrls(example));
      }

      const ignore = path.join(dir, ".gitignore");

      const ignored = (read(ignore) ?? "")
        .split("\n")
        .map((line) => line.trim());

      if (!ignored.includes(AUTH_DATA) && !ignored.includes(`/${AUTH_DATA}`)) {
        appendFileSync(
          ignore,
          `${ignored.at(-1) === "" ? "" : "\n"}# App tokens, one per store (Saleor CLI)\n${AUTH_DATA}\n`
        );
      }

      return warnings;
    },
  });

export interface Made {
  readonly created: boolean;
  readonly dir: string;
  readonly downloaded?: Downloaded | undefined;
  readonly identifier: string;
  readonly name: string;
}

// Sets up a downloaded copy: id and name (only when just downloaded), the component,
// a repository and its packages. Everything after the files only warns.
export const finishApp = (spec: Made) =>
  Effect.gen(function* () {
    const warnings = spec.created
      ? yield* personalize(spec.dir, spec.name, spec.identifier)
      : [];

    const component = yield* recordComponent(spec.dir, { kind: "app" });

    const copy = yield* finishCopy({
      dir: spec.dir,
      downloaded: spec.downloaded,
      install: true,
      repository: spec.created ? spec.dir : undefined,
      template: TEMPLATE,
    });

    const all = [...warnings, ...copy.warnings];

    const next = [
      ...copy.next,
      "saleor app add <env> --manifest <url>/api/manifest",
    ];

    return result(
      {
        component: Option.getOrNull(component),
        created: spec.created,
        identifier: spec.identifier,
        installed: copy.installed,
        name: spec.name,
        next,
        path: spec.dir,
        repository: copy.repository,
        template: copy.template,
        warnings: all,
      },
      [
        columns([
          ["  Directory:", shown(spec.dir)],
          ["  Manifest id:", spec.identifier],
        ]),
        ...all.map((warning) => `  Warning: ${warning}`),
        ...Option.match(component, {
          onNone: () => [],
          onSome: (name) => [`  Listed in saleor.yml as component "${name}".`],
        }),
        "",
        "Run it, then install it on a store:",
        ...next.map((line) => `  ${line}`),
        "",
        "<url> is http://localhost:3000 for a local store; the CLI points the store in Docker",
        "and the app's .env at this computer. A Saleor Cloud store needs a tunnel to port 3000.",
      ].join("\n")
    );
  });

export const createApp = (spec: Made) =>
  Effect.flatMap(downloadTemplate(TEMPLATE, spec.dir), (downloaded) =>
    finishApp({ ...spec, downloaded })
  );
