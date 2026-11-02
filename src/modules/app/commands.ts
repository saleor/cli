import { Effect, Option } from "effect";
import {
  absent,
  defineActions,
  defineGroup,
  type Ensured,
  listing,
  type Planned,
  type TargetRef,
} from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { option } from "../../core/inputs.ts";
import { envInput } from "../../core/instances.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { connectStore } from "../../core/store-api.ts";
import {
  appsOn,
  fetchManifest,
  install,
  installed,
  type InstalledApp,
  retryInstall,
  type Store,
  uninstall,
} from "./store.ts";

const app = defineActions();

// Managing apps takes MANAGE_APPS, and Saleor only lets a token grant permissions its
// owner has.
const connect = (env: Option.Option<string>, needs: string) =>
  Effect.map(connectStore(env, { needs }), ({ instance, token }): Store => ({
    instance,
    token: Option.getOrElse(token, () => ""),
  }));

const appTarget = (store: Store, name: string, id: string | null) =>
  ({
    id,
    name,
    scope: { store: store.instance.ref },
    type: "app",
  }) satisfies TargetRef;

const shown = (each: InstalledApp) => ({
  active: each.isActive ?? false,
  id: each.id,
  identifier: each.identifier,
  manifestUrl: each.manifestUrl,
  name: each.name ?? each.id,
  type: each.type,
});

const listCommand = app.list({
  description:
    "The apps installed on a store, and installations that are still running or have failed. Needs a store token with MANAGE_APPS.",
  examples: [
    {
      command: "saleor app list local",
      description: "Apps on the local store",
    },
  ],
  inputs: { env: envInput },
  name: "list",
  run: (input) =>
    Effect.gen(function* () {
      const store = yield* connect(input.env, "the MANAGE_APPS permission");
      const { apps, installations } = yield* appsOn(store);

      const items = [
        ...apps.map((each) => ({
          ...shown(each),
          state: each.isActive === false ? "inactive" : "installed",
        })),
        ...installations.map((each) => ({
          active: false,
          id: each.id,
          identifier: null,
          manifestUrl: each.manifestUrl,
          name: each.appName,
          state: each.status === "FAILED" ? "failed" : "installing",
          type: null,
        })),
      ];

      return listing(
        items,
        [
          ["NAME", (item) => item.name],
          ["STATE", (item) => item.state],
          ["ID", (item) => item.id],
          ["MANIFEST", (item) => item.manifestUrl],
        ],
        `No apps on ${store.instance.ref}.`
      );
    }),
  summary: "List the apps on a store.",
});

interface Added {
  readonly app: ReturnType<typeof shown>;
  readonly created: boolean;
  readonly store: string;
}

const done = (store: Store, each: InstalledApp, created: boolean) =>
  ({
    data: { app: shown(each), created, store: store.instance.ref },
    headline: created
      ? `Installed the app "${each.name ?? each.id}" on ${store.instance.ref}.`
      : `The app "${each.name ?? each.id}" is already installed on ${store.instance.ref}.`,
    text: "",
  }) satisfies Ensured<Added>;

const addCommand = app.ensure({
  description:
    "Install an app on a store from its manifest URL, with the permissions its manifest asks for, and wait until it is installed. An app with the same manifest URL is reused; an installation of it that failed is retried. The store fetches the manifest itself, so the URL must be reachable from the store. Needs a store token with MANAGE_APPS and every permission the app asks for.",
  examples: [
    {
      command:
        "saleor app add staging --manifest https://my-app.example.com/api/manifest",
      description: "Install an app on the staging store",
    },
  ],
  inputs: {
    env: envInput,
    manifest: option.string("manifest", {
      description: "The app's manifest URL.",
      metavar: "url",
    }),
  },
  name: "add",
  plan: (input) =>
    Effect.gen(function* () {
      if (Option.isNone(input.manifest)) {
        return yield* fail("USAGE_ERROR", "Name the app to install.", {
          suggestion: "Pass its manifest URL with --manifest <url>.",
        });
      }

      const manifestUrl = input.manifest.value;

      const store = yield* connect(
        input.env,
        "MANAGE_APPS and the permissions the app asks for"
      );

      const deadline = deadlineIn(input.timeout);
      const { apps, installations } = yield* appsOn(store);
      const existing = apps.find((each) => each.manifestUrl === manifestUrl);

      if (existing !== undefined) {
        return {
          action: "reuse",
          apply: Effect.succeed(done(store, existing, false)),
          details: { app: shown(existing) },
          risk: null,
          state: "exists",
          target: appTarget(store, existing.name ?? existing.id, existing.id),
        } satisfies Planned<Ensured<Added>, unknown>;
      }

      const earlier = installations.find(
        (each) => each.manifestUrl === manifestUrl
      );

      // Already installing: wait for it rather than start a second installation.
      if (earlier !== undefined && earlier.status !== "FAILED") {
        return {
          action: "reuse",
          apply: Effect.map(
            installed(
              store,
              { installationId: earlier.id, manifestUrl },
              deadline
            ),
            (made) => done(store, made, true)
          ),
          details: { installation: earlier },
          risk: null,
          state: "starting",
          target: appTarget(store, earlier.appName, null),
        } satisfies Planned<Ensured<Added>, unknown>;
      }

      const manifest = yield* fetchManifest(store, manifestUrl);
      const permissions = manifest.permissions.join(", ") || "none";

      return {
        action: "create",
        apply: Effect.gen(function* () {
          const installation =
            earlier === undefined
              ? yield* install(store, { ...manifest, manifestUrl })
              : yield* retryInstall(store, earlier.id);

          return done(
            store,
            yield* installed(
              store,
              { installationId: installation, manifestUrl },
              deadline
            ),
            true
          );
        }),
        details: {
          identifier: manifest.identifier,
          manifestUrl,
          permissions: manifest.permissions,
          retry: earlier !== undefined,
        },
        notice: `It gets these permissions on ${store.instance.ref}: ${permissions}.`,
        risk: null,
        state: "absent",
        summary: [
          ["Manifest", manifestUrl],
          ["Permissions", permissions],
        ],
        target: appTarget(store, manifest.name, null),
      } satisfies Planned<Ensured<Added>, unknown>;
    }),
  summary: "Install an app on a store.",
  waits: true,
});

// An app named by its id, identifier or manifest URL, else by its name when only one
// app has it.
const findApp = (apps: readonly InstalledApp[], wanted: string) =>
  Effect.gen(function* () {
    const exact = apps.find((each) =>
      [each.id, each.identifier, each.manifestUrl].includes(wanted)
    );

    if (exact !== undefined) {
      return Option.some(exact);
    }

    const named = apps.filter((each) => each.name === wanted);

    if (named.length > 1) {
      return yield* fail(
        "USAGE_ERROR",
        `${named.length} apps are named "${wanted}".`,
        {
          details: { apps: named.map(shown) },
          suggestion: `Name one by its id: ${named.map((each) => each.id).join(", ")}`,
        }
      );
    }

    return Option.fromUndefinedOr(named[0]);
  });

const removeCommand = app.remove({
  description:
    "Uninstall an app from a store, named by its name, id, identifier or manifest URL. Its webhooks, tokens and settings on the store are deleted. An app that is not there succeeds without changes. Needs a store token with MANAGE_APPS.",
  examples: [
    {
      command: "saleor app remove staging --app 'My app' --force",
      description: "Uninstall an app without asking",
    },
  ],
  inputs: {
    app: option.string("app", {
      description: "The app: its name, id, identifier or manifest URL.",
      metavar: "app",
    }),
    env: envInput,
  },
  name: "remove",
  plan: (input) =>
    Effect.gen(function* () {
      if (Option.isNone(input.app)) {
        return yield* fail("USAGE_ERROR", "Name the app to uninstall.", {
          suggestion: `Pass --app <name or id>; see the apps with: saleor app list`,
        });
      }

      const store = yield* connect(input.env, "the MANAGE_APPS permission");
      const { apps } = yield* appsOn(store);
      const found = yield* findApp(apps, input.app.value);

      if (Option.isNone(found)) {
        return absent(appTarget(store, input.app.value, null));
      }

      const each = found.value;

      return {
        action: "delete",
        apply: Effect.as(uninstall(store, each.id), { app: shown(each) }),
        details: { app: shown(each) },
        risk: "Its webhooks, tokens and settings on the store are deleted.",
        state: "exists",
        target: appTarget(store, each.name ?? each.id, each.id),
      } satisfies Planned<{ readonly app: ReturnType<typeof shown> }, unknown>;
    }),
  risk: "Uninstalling deletes the app's webhooks, tokens and settings on the store.",
  summary: "Uninstall an app from a store.",
});

// Saleor has no reinstall: the app is deleted and installed again from its manifest
// URL. The manifest is read before anything is deleted, so an app whose manifest the
// store cannot reach stays installed.
const reinstallCommand = app.ensure({
  description:
    "Uninstall an app and install it again from its manifest URL, with the permissions its manifest asks for now, then wait until it is installed. Named by its name, id, identifier or manifest URL. Its webhooks, tokens and settings on the store are deleted, and the app sets them up again as on a first install. Needs a store token with MANAGE_APPS and every permission the app asks for.",
  examples: [
    {
      command: "saleor app reinstall staging --app 'My app' --force",
      description: "Reinstall an app without asking",
    },
  ],
  inputs: {
    app: option.string("app", {
      description: "The app: its name, id, identifier or manifest URL.",
      metavar: "app",
    }),
    env: envInput,
  },
  name: "reinstall",
  plan: (input) =>
    Effect.gen(function* () {
      if (Option.isNone(input.app)) {
        return yield* fail("USAGE_ERROR", "Name the app to reinstall.", {
          suggestion:
            "Pass --app <name or id>; see the apps with: saleor app list",
        });
      }

      const store = yield* connect(
        input.env,
        "MANAGE_APPS and the permissions the app asks for"
      );

      const { apps } = yield* appsOn(store);
      const found = yield* findApp(apps, input.app.value);

      if (Option.isNone(found)) {
        return yield* fail(
          "NOT_FOUND",
          `No app "${input.app.value}" on ${store.instance.ref}.`,
          {
            suggestion:
              "See the apps with: saleor app list. To install one, run: saleor app add --manifest <url>",
          }
        );
      }

      const each = found.value;
      const { manifestUrl } = each;

      if (manifestUrl === null) {
        return yield* fail(
          "USAGE_ERROR",
          `"${each.name ?? each.id}" was not installed from a manifest, so it cannot be reinstalled.`
        );
      }

      const manifest = yield* fetchManifest(store, manifestUrl);
      const permissions = manifest.permissions.join(", ") || "none";
      const deadline = deadlineIn(input.timeout);

      return {
        action: "update",
        apply: Effect.gen(function* () {
          yield* uninstall(store, each.id);

          const installation = yield* install(store, {
            ...manifest,
            manifestUrl,
          });

          const made = yield* installed(
            store,
            { installationId: installation, manifestUrl },
            deadline
          );

          return {
            ...done(store, made, true),
            headline: `Reinstalled the app "${made.name ?? made.id}" on ${store.instance.ref}.`,
          };
        }),
        details: { app: shown(each), permissions: manifest.permissions },
        risk: "Its webhooks, tokens and settings on the store are deleted before it is installed again.",
        state: "exists",
        summary: [
          ["Manifest", manifestUrl],
          ["Permissions", permissions],
        ],
        target: appTarget(store, each.name ?? each.id, each.id),
      } satisfies Planned<Ensured<Added>, unknown>;
    }),
  risk: "Reinstalling deletes the app's webhooks, tokens and settings on the store before installing it again.",
  summary: "Uninstall an app and install it again.",
  waits: true,
});

export const appCommand = defineGroup({
  actions: [listCommand, addCommand, reinstallCommand, removeCommand],
  description:
    "Apps installed on a store. Name the store with the word after the command, as in every command: a name from saleor.yml or a store ref (cloud:<org>/<env key>, local:<name>); its token is found for you and needs MANAGE_APPS.",
  name: "app",
  summary: "List, install, reinstall and uninstall a store's apps.",
});
