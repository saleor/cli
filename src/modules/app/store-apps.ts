import { Effect, Option } from "effect";
import type { Ensured, Planned } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { askMultiSelect, isInteractive } from "../../core/interaction.ts";
import { recordAnswer } from "../../core/invocation.ts";
import type { Deadline } from "../../core/readiness.ts";
import { resolveStoreApps, type StoreApp, storeApps } from "./catalog.ts";
import {
  appsOn,
  fetchManifest,
  type InstalledApp,
  installed,
  installFrom,
  type Manifest,
} from "./store.ts";
import { deleteApp } from "../../core/store-apps.ts";
import type { StoreClient } from "../../core/store-api.ts";

// App Store apps on one store: install the ones named, or, in a terminal, tick them in
// a list where installed apps start ticked, so unticking one uninstalls it.

export interface StoreAppsResult {
  readonly created: boolean;
  readonly installed: readonly string[];
  readonly removed: readonly string[];
  readonly store: string;
}

// App Store apps are hosted by Saleor and call back to the store's API, which a store
// on this computer does not offer them.
const cloudOnly = (client: StoreClient) =>
  client.store.kind === "local"
    ? Effect.fail(
        fail(
          "USAGE_ERROR",
          `App Store apps cannot be installed on ${client.store.ref}: they run in Saleor Cloud and cannot reach a store on this computer.`,
          {
            suggestion:
              "Install them on a Saleor Cloud store, or install an app you run yourself with --manifest <url>.",
          }
        )
      )
    : Effect.void;

const choiceOf = (each: StoreApp, installedUrls: ReadonlySet<string>) =>
  installedUrls.has(each.manifestUrl)
    ? { hint: "installed", label: each.name, value: each.manifestUrl }
    : { label: each.name, value: each.manifestUrl };

const pick = (
  catalog: readonly StoreApp[],
  installedUrls: ReadonlySet<string>
) =>
  Effect.gen(function* () {
    if (!(yield* isInteractive)) {
      return yield* fail("USAGE_ERROR", "Name the apps to install.", {
        suggestion:
          "Pass App Store apps with --store-app <id,…> (see them with: saleor app list --store-apps), or a manifest URL with --manifest <url>.",
      });
    }

    const groups: Record<string, ReturnType<typeof choiceOf>[]> = {};

    for (const each of catalog) {
      (groups[each.category] ??= []).push(choiceOf(each, installedUrls));
    }

    const ticked = new Set(
      yield* askMultiSelect({
        groups,
        initialValues: catalog.flatMap((each) =>
          installedUrls.has(each.manifestUrl) ? [each.manifestUrl] : []
        ),
        message:
          "Which App Store apps should this store have? Space ticks, Enter confirms.",
      })
    );

    return catalog.filter((each) => ticked.has(each.manifestUrl));
  });

const nameOf = (each: InstalledApp) => each.name ?? each.id;

interface Changes {
  readonly installations: Effect.Success<
    ReturnType<typeof appsOn>
  >["installations"];
  readonly manifests: readonly {
    readonly each: StoreApp;
    readonly manifest: Manifest;
  }[];
  readonly toRemove: readonly InstalledApp[];
}

// What the store should have: the apps named, or ticked in the list. Only the list
// removes; an app named with --store-app is added to the others.
const decide = (
  client: StoreClient,
  wanted: Option.Option<readonly string[]>
) =>
  Effect.gen(function* () {
    const catalog = yield* storeApps;
    const { apps, installations } = yield* appsOn(client);

    const installedUrls = new Set(
      apps.flatMap((each) =>
        each.manifestUrl === null ? [] : [each.manifestUrl]
      )
    );

    const selected = Option.isSome(wanted)
      ? yield* resolveStoreApps(catalog, wanted.value)
      : yield* pick(catalog, installedUrls);

    const chosen = new Set(selected.map((each) => each.manifestUrl));
    const fromCatalog = new Set(catalog.map((each) => each.manifestUrl));

    const toRemove = Option.isNone(wanted)
      ? apps.filter(
          (each) =>
            each.manifestUrl !== null &&
            fromCatalog.has(each.manifestUrl) &&
            !chosen.has(each.manifestUrl)
        )
      : [];

    // A rerun with --store-app would not uninstall, so only a list without removals
    // is offered as one.
    if (Option.isNone(wanted) && toRemove.length === 0 && selected.length > 0) {
      yield* recordAnswer({
        option: ["--store-app", selected.map((each) => each.id).join(",")],
      });
    }

    // Read now, so a manifest the store cannot reach fails before anything changes.
    const manifests = yield* Effect.forEach(
      selected.filter((each) => !installedUrls.has(each.manifestUrl)),
      (each) =>
        Effect.map(fetchManifest(client, each.manifestUrl), (manifest) => ({
          each,
          manifest,
        }))
    );

    return { installations, manifests, toRemove } satisfies Changes;
  });

const headlineOf = (
  client: StoreClient,
  done: readonly string[],
  removed: readonly string[]
) => {
  if (done.length === 0 && removed.length === 0) {
    return `${client.store.ref} already has the App Store apps asked for.`;
  }

  const parts = [
    done.length > 0 ? `Installed ${done.join(", ")}` : "",
    removed.length > 0 ? `Uninstalled ${removed.join(", ")}` : "",
  ];

  return `${parts.filter(Boolean).join("; ")} on ${client.store.ref}.`;
};

const applyChanges = (
  client: StoreClient,
  changes: Changes,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    for (const each of changes.toRemove) {
      yield* deleteApp(client, each.id);
    }

    for (const { each, manifest } of changes.manifests) {
      const { manifestUrl } = each;

      const pending = changes.installations.find(
        (installation) => installation.manifestUrl === manifestUrl
      );

      yield* pending !== undefined && pending.status !== "FAILED"
        ? installed(
            client,
            { installationId: pending.id, manifestUrl },
            deadline
          )
        : installFrom(
            client,
            { failed: pending, manifest, manifestUrl },
            deadline
          );
    }

    const done = changes.manifests.map(({ each }) => each.name);
    const removed = changes.toRemove.map(nameOf);

    return {
      data: {
        created: done.length > 0,
        installed: done,
        removed,
        store: client.store.ref,
      },
      headline: headlineOf(client, done, removed),
      text: "",
    } satisfies Ensured<StoreAppsResult>;
  });

const actionOf = (changes: Changes) => {
  if (changes.toRemove.length > 0) {
    return "update";
  }

  return changes.manifests.length > 0 ? "create" : "reuse";
};

export const planStoreApps = (
  client: StoreClient,
  wanted: Option.Option<readonly string[]>,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    yield* cloudOnly(client);

    const changes = yield* decide(client, wanted);
    const removed = changes.toRemove.map(nameOf);
    const action = actionOf(changes);

    return {
      action,
      apply: applyChanges(client, changes, deadline),
      details: {
        install: changes.manifests.map(({ each, manifest }) => ({
          id: each.id,
          manifestUrl: each.manifestUrl,
          name: each.name,
          permissions: manifest.permissions,
        })),
        remove: removed,
      },
      risk:
        removed.length > 0
          ? `Uninstalling ${removed.join(", ")} deletes their webhooks, tokens and settings on the store.`
          : null,
      state: action === "reuse" ? "exists" : "absent",
      summary: [
        ...changes.manifests.map(
          ({ each, manifest }) =>
            [
              `Install ${each.name}`,
              manifest.permissions.join(", ") || "no permissions",
            ] as const
        ),
        ...removed.map((name) => [`Uninstall ${name}`, ""] as const),
      ],
      target: {
        id: null,
        name: "App Store apps",
        scope: { store: client.store.ref },
        type: "apps",
      },
    } satisfies Planned<Ensured<StoreAppsResult>, unknown>;
  });
