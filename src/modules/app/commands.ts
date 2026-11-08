import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
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
import type { Given } from "../../core/target.ts";
import { appChoices, appInput } from "./targets.ts";
import { option } from "../../core/inputs.ts";
import { envInput } from "../../core/stores.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { connectStore, type StoreClient } from "../../core/store-api.ts";
import {
  appsOn,
  canReadManifest,
  fetchManifest,
  install,
  type InstalledApp,
  installationFailed,
  installed,
  installFrom,
  writeMetadata,
} from "./store.ts";
import { deleteApp } from "../../core/store-apps.ts";
import { catalogUrls, sourceOf, storeApps } from "./catalog.ts";
import { reachableManifest } from "./docker-host.ts";
import { createCommand } from "./create-command.ts";
import { metadataToCopy } from "./metadata-copy.ts";
import { planStoreApps, type StoreAppsResult } from "./store-apps.ts";

const app = defineActions();

// Managing apps takes MANAGE_APPS, and Saleor only lets a token grant permissions its
// owner has. Installing takes a staff user's token besides: Saleor refuses appInstall
// to an app token.
const connect = (
  env: Given,
  needs: string,
  { staff = false }: { readonly staff?: boolean } = {}
) => connectStore(env, { needs, staff });

const appTarget = (client: StoreClient, name: string, id: string | null) =>
  ({
    id,
    name,
    scope: { store: client.store.ref },
    type: "app",
  }) satisfies TargetRef;

const appData = (each: InstalledApp) => ({
  active: each.isActive ?? false,
  id: each.id,
  identifier: each.identifier,
  manifestUrl: each.manifestUrl,
  name: each.name ?? each.id,
  type: each.type,
});

interface Row {
  readonly category: string | null;
  readonly id: string;
  readonly manifestUrl: string | null;
  readonly name: string;
  // Where an installed app comes from: the App Store, or anywhere else.
  readonly source: "app-store" | "other" | null;
  readonly state: string | null;
}

// The App Store's apps, for choosing what to pass to --store-app.
const catalogRows = Effect.map(storeApps, (catalog) =>
  listing<Row>(
    catalog.map((each) => ({
      category: each.category,
      id: each.id,
      manifestUrl: each.manifestUrl,
      name: each.name,
      source: "app-store",
      state: null,
    })),
    [
      ["ID", (item) => item.id],
      ["NAME", (item) => item.name],
      ["CATEGORY", (item) => item.category],
    ],
    "The Saleor App Store lists no apps that can be installed."
  )
);

const listCommand = app.list({
  description:
    "The apps installed on a store, with where they come from (the Saleor App Store or elsewhere), and installations that are still running or have failed. Needs a store token with MANAGE_APPS. With --store-apps, the apps the Saleor App Store offers instead, with the ids --store-app takes; that needs no store.",
  examples: [
    {
      command: "saleor app list local",
      description: "Apps on the local store",
    },
    {
      command: "saleor app list --store-apps",
      description: "Apps in the Saleor App Store",
    },
  ],
  inputs: {
    env: envInput,
    storeApps: option.boolean(
      "store-apps",
      "List the Saleor App Store's apps instead of a store's."
    ),
  },
  name: "list",
  run: (input) =>
    Effect.gen(function* () {
      if (input.storeApps) {
        return yield* catalogRows;
      }

      const client = yield* connect(input.env, "the MANAGE_APPS permission");
      const { apps, installations } = yield* appsOn(client);
      const fromStore = yield* catalogUrls(client.store);

      const items: Row[] = [
        ...apps.map((each) => ({
          category: null,
          id: each.id,
          manifestUrl: each.manifestUrl,
          name: each.name ?? each.id,
          source: sourceOf(fromStore, each.manifestUrl),
          state: each.isActive === false ? "inactive" : "installed",
        })),
        ...installations.map((each) => ({
          category: null,
          id: each.id,
          manifestUrl: each.manifestUrl,
          name: each.appName,
          source: null,
          state: installationFailed(each) ? "failed" : "installing",
        })),
      ];

      return listing(
        items,
        [
          ["NAME", (item) => item.name],
          ["STATE", (item) => item.state],
          ["SOURCE", (item) => item.source?.replace("-", " ") ?? null],
          ["ID", (item) => item.id],
          ["MANIFEST", (item) => item.manifestUrl],
        ],
        `No apps on ${client.store.ref}.`
      );
    }),
  summary: "See the apps installed on a store.",
});

interface Added {
  readonly app: ReturnType<typeof appData>;
  readonly created: boolean;
  readonly store: string;
}

const done = (client: StoreClient, each: InstalledApp, created: boolean) =>
  ({
    data: { app: appData(each), created, store: client.store.ref },
    headline: created
      ? `Installed the app "${each.name ?? each.id}" on ${client.store.ref}.`
      : `The app "${each.name ?? each.id}" is already installed on ${client.store.ref}.`,
    text: "",
  }) satisfies Ensured<Added>;

// `add` plans one app by its manifest URL, or App Store apps.
type AddPlan = Planned<Ensured<Added | StoreAppsResult>, HttpClient.HttpClient>;

const addPlan = (plan: AddPlan) => plan;

const addCommand = app.ensure({
  description:
    "Install apps on a store, with the permissions their manifests ask for, and wait until they are installed. Name an app by its manifest URL with --manifest (the store fetches it, so it must be reachable from the store; for a local store in Docker, a localhost URL is given to the store as host.docker.internal, and a project app's .env gets APP_API_BASE_URL and APP_IFRAME_BASE_URL so its manifest sends the store there too), or Saleor App Store apps with --store-app (Saleor Cloud stores only; see them with app list --store-apps). With neither, in a terminal on a Cloud store, it lists the App Store's apps to tick, with the installed ones ticked: unticking one uninstalls it, after confirmation. An app already installed is reused; an installation that failed is retried. Needs a store token with MANAGE_APPS and every permission the apps ask for.",
  examples: [
    {
      command:
        "saleor app add staging --manifest https://my-app.example.com/api/manifest",
      description: "Install an app on the staging store",
    },
    {
      command: "saleor app add staging --store-app avatax,klaviyo",
      description: "Install App Store apps",
    },
    {
      command: "saleor app add staging",
      description: "Choose App Store apps in a list",
    },
  ],
  inputs: {
    env: envInput,
    manifest: option.string("manifest", {
      description: "The app's manifest URL.",
      metavar: "url",
    }),
    storeApp: option.string("store-app", {
      description:
        "Saleor App Store apps, by id or name, separated by commas: avatax,klaviyo.",
      metavar: "apps",
    }),
  },
  name: "add",
  plan: (input) =>
    Effect.gen(function* () {
      if (Option.isSome(input.manifest) && Option.isSome(input.storeApp)) {
        return yield* fail(
          "USAGE_ERROR",
          "Pass --manifest or --store-app, not both."
        );
      }

      const client = yield* connect(
        input.env,
        "MANAGE_APPS and the permissions the apps ask for",
        { staff: true }
      );

      const deadline = deadlineIn(input.timeout);

      if (Option.isNone(input.manifest)) {
        return addPlan(
          yield* planStoreApps(
            client,
            Option.map(input.storeApp, (list) =>
              list
                .split(",")
                .map((word) => word.trim())
                .filter((word) => word !== "")
            ),
            deadline
          )
        );
      }

      const reach = yield* reachableManifest(
        client.store,
        input.manifest.value
      );

      const { manifestUrl } = reach;
      const { apps, installations } = yield* appsOn(client);
      const existing = apps.find((each) => each.manifestUrl === manifestUrl);

      if (existing !== undefined) {
        return addPlan({
          action: "reuse",
          apply: Effect.succeed(done(client, existing, false)),
          details: { app: appData(existing) },
          risk: null,
          state: "exists",
          target: appTarget(client, existing.name ?? existing.id, existing.id),
        });
      }

      const earlier = installations.find(
        (each) => each.manifestUrl === manifestUrl
      );

      // Already installing: wait for it rather than start a second installation.
      if (earlier !== undefined && !installationFailed(earlier)) {
        return addPlan({
          action: "reuse",
          apply: Effect.map(
            installed(
              client,
              { installationId: earlier.id, manifestUrl },
              deadline
            ),
            (made) => done(client, made, true)
          ),
          details: { installation: earlier },
          risk: null,
          state: "starting",
          target: appTarget(client, earlier.appName, null),
        });
      }

      const manifest = yield* fetchManifest(client, manifestUrl);
      const permissions = manifest.permissions.join(", ") || "none";

      return addPlan({
        action: "create",
        apply: Effect.map(
          Effect.andThen(
            reach.prepare,
            installFrom(
              client,
              { failed: earlier, manifest, manifestUrl },
              deadline
            )
          ),
          (made) => done(client, made, true)
        ),
        details: {
          env: reach.env,
          identifier: manifest.identifier,
          manifestUrl,
          permissions: manifest.permissions,
          retry: earlier !== undefined,
        },
        notice: `It gets these permissions on ${client.store.ref}: ${permissions}.`,
        risk: null,
        state: "absent",
        summary: [
          ["Manifest", manifestUrl],
          ["Permissions", permissions],
          ...reach.summary,
        ],
        target: appTarget(client, manifest.name, null),
      });
    }),
  risk: "In the App Store list, unticking an installed app uninstalls it, deleting its webhooks, tokens and settings on the store.",
  summary: "Install apps on a store.",
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
          details: { apps: named.map(appData) },
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
    app: appInput,
    env: envInput,
  },
  name: "remove",
  plan: (input) =>
    Effect.gen(function* () {
      const client = yield* connect(input.env, "the MANAGE_APPS permission");
      const { apps } = yield* appsOn(client);

      const wanted = yield* appInput.resolve(
        input.app,
        appChoices(client, apps)
      );

      const found = yield* findApp(apps, wanted);

      if (Option.isNone(found)) {
        return absent(appTarget(client, wanted, null));
      }

      const each = found.value;

      return {
        action: "delete",
        apply: Effect.as(deleteApp(client, each.id), { app: appData(each) }),
        details: { app: appData(each) },
        risk: "Its webhooks, tokens and settings on the store are deleted.",
        state: "exists",
        target: appTarget(client, each.name ?? each.id, each.id),
      } satisfies Planned<
        { readonly app: ReturnType<typeof appData> },
        unknown
      >;
    }),
  risk: "Uninstalling deletes the app's webhooks, tokens and settings on the store.",
  summary: "Uninstall an app from a store.",
});

// Saleor has no reinstall: the app is deleted and installed again from its manifest
// URL. The manifest is read before anything is deleted, so an app whose manifest the
// store cannot reach stays installed.
const reinstallCommand = app.ensure({
  description:
    "Uninstall an app and install it again from its manifest URL, so the store applies what the manifest asks for now (permissions, webhooks), then wait until it is installed. Saleor has no reinstall, so this is an uninstall followed by a new install: the new app has a new id, and its tokens and webhooks are created again. The CLI cannot know where the app keeps its settings or data. With --copy-metadata (asked in a terminal), the old app's metadata and private metadata, where apps often keep their configuration, are copied to the new one. Anything the app keeps in its own storage for the old installation may not carry over. Named by its name, id, identifier or manifest URL. Needs a store token with MANAGE_APPS and every permission the app asks for.",
  examples: [
    {
      command:
        "saleor app reinstall staging --app 'My app' --copy-metadata --force",
      description: "Reinstall an app, keeping its metadata, without asking",
    },
  ],
  inputs: {
    app: appInput,
    copyMetadata: option.boolean(
      "copy-metadata",
      "Copy the old app's metadata and private metadata to the new one. Asked in a terminal."
    ),
    env: envInput,
  },
  name: "reinstall",
  plan: (input) =>
    Effect.gen(function* () {
      const client = yield* connect(
        input.env,
        "MANAGE_APPS and the permissions the app asks for",
        { staff: true }
      );

      const { apps } = yield* appsOn(client);

      // Only an app installed from a manifest can be installed again.
      const wanted = yield* appInput.resolve(
        input.app,
        appChoices(
          client,
          apps.filter((each) => each.manifestUrl !== null)
        )
      );

      const found = yield* findApp(apps, wanted);

      if (Option.isNone(found)) {
        return yield* fail(
          "NOT_FOUND",
          `No app "${wanted}" on ${client.store.ref}.`,
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

      yield* canReadManifest(client, manifestUrl);
      const deadline = deadlineIn(input.timeout);

      const { copying, keys, metadata } = yield* metadataToCopy(
        client,
        each.id,
        input.copyMetadata
      );

      return {
        action: "update",
        apply: Effect.gen(function* () {
          yield* deleteApp(client, each.id);

          // Read again now that the app is gone, for the permissions it asks for.
          const manifest = yield* fetchManifest(client, manifestUrl);

          const installation = yield* install(client, {
            ...manifest,
            manifestUrl,
          });

          const made = yield* installed(
            client,
            { installationId: installation, manifestUrl },
            deadline
          );

          if (copying) {
            yield* writeMetadata(client, made.id, metadata);
          }

          return {
            ...done(client, made, true),
            headline: `Reinstalled the app "${made.name ?? made.id}" on ${client.store.ref}${copying ? ", with its metadata" : ""}.`,
          };
        }),
        details: { app: appData(each), copyMetadata: copying },
        risk: copying
          ? "Saleor has no reinstall: the app is uninstalled and installed again as a new app. Its metadata is copied over, but anything it keeps elsewhere for the old installation may not carry over."
          : "Saleor has no reinstall: the app is uninstalled and installed again as a new app. Its metadata is deleted, and anything it keeps elsewhere for the old installation may not carry over.",
        state: "exists",
        summary: [
          ["Manifest", manifestUrl],
          [
            "Permissions",
            "what its manifest asks for, read after uninstalling",
          ],
          [
            "Metadata",
            keys === 0
              ? "none"
              : `${keys} ${keys === 1 ? "key" : "keys"}, ${copying ? "copied to the new app" : "not copied"}`,
          ],
        ],
        target: appTarget(client, each.name ?? each.id, each.id),
      } satisfies Planned<Ensured<Added>, unknown>;
    }),
  risk: "Saleor has no reinstall: the app is uninstalled and installed again as a new app, with a new id. Its webhooks, tokens and, unless copied, metadata are deleted; settings the app keeps elsewhere may not carry over.",
  summary: "Reinstall an app to apply its manifest changes.",
  waits: true,
});

export const appCommand = defineGroup({
  actions: [
    createCommand,
    listCommand,
    addCommand,
    reinstallCommand,
    removeCommand,
  ],
  description:
    "Apps installed on a store. Name the store with the word after the command, as in every command: a name from saleor.yml or a store ref (cloud:<org>/<env key>, local:<name>); its token is found for you and needs MANAGE_APPS.",
  name: "app",
  summary: "Install apps on a store, or create your own.",
});
