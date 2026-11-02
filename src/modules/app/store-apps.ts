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
  type Store,
  uninstall,
} from "./store.ts";

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
const cloudOnly = (store: Store) =>
  store.instance.kind === "local"
    ? Effect.fail(
        fail(
          "USAGE_ERROR",
          `App Store apps cannot be installed on ${store.instance.ref}: they run in Saleor Cloud and cannot reach a store on this computer.`,
          {
            suggestion:
              "Install them on a Saleor Cloud store, or install an app you run yourself with --manifest <url>.",
          }
        )
      )
    : Effect.void;

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

    const groups: Record<
      string,
      { hint?: string; label: string; value: string }[]
    > = {};

    for (const each of catalog) {
      (groups[each.category] ??= []).push({
        ...(installedUrls.has(each.manifestUrl) ? { hint: "installed" } : {}),
        label: each.name,
        value: each.manifestUrl,
      });
    }

    const ticked = new Set(
      yield* askMultiSelect({
        groups,
        initialValues: catalog
          .map((each) => each.manifestUrl)
          .filter((url) => installedUrls.has(url)),
        message:
          "Which App Store apps should this store have? Space ticks, Enter confirms.",
      })
    );

    return catalog.filter((each) => ticked.has(each.manifestUrl));
  });

const nameOf = (each: InstalledApp) => each.name ?? each.id;

export const planStoreApps = (
  store: Store,
  wanted: Option.Option<readonly string[]>,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    yield* cloudOnly(store);

    const catalog = yield* storeApps;
    const { apps, installations } = yield* appsOn(store);
    const installedUrls = new Set(
      apps.flatMap((each) =>
        each.manifestUrl === null ? [] : [each.manifestUrl]
      )
    );

    const picked = Option.isNone(wanted);

    const selected = Option.isSome(wanted)
      ? yield* resolveStoreApps(catalog, wanted.value)
      : yield* pick(catalog, installedUrls);

    const chosen = new Set(selected.map((each) => each.manifestUrl));
    const toInstall = selected.filter(
      (each) => !installedUrls.has(each.manifestUrl)
    );

    // Only the list removes: an app named with --store-app is added to the others.
    const toRemove = picked
      ? apps.filter(
          (each) =>
            each.manifestUrl !== null &&
            catalog.some((entry) => entry.manifestUrl === each.manifestUrl) &&
            !chosen.has(each.manifestUrl)
        )
      : [];

    if (picked && toRemove.length === 0 && selected.length > 0) {
      yield* recordAnswer({
        option: ["--store-app", selected.map((each) => each.id).join(",")],
      });
    }

    // Read now, so a manifest the store cannot reach fails before anything changes.
    const manifests = yield* Effect.forEach(toInstall, (each) =>
      Effect.map(fetchManifest(store, each.manifestUrl), (manifest) => ({
        each,
        manifest,
      }))
    );

    const removedNames = toRemove.map(nameOf);
    const changes = toInstall.length > 0 || toRemove.length > 0;

    let action: "create" | "reuse" | "update" = "reuse";

    if (toRemove.length > 0) {
      action = "update";
    } else if (changes) {
      action = "create";
    }

    const apply = Effect.gen(function* () {
      for (const each of toRemove) {
        yield* uninstall(store, each.id);
      }

      for (const { each, manifest } of manifests) {
        const pending = installations.find(
          (installation) => installation.manifestUrl === each.manifestUrl
        );

        yield* pending !== undefined && pending.status !== "FAILED"
          ? installed(
              store,
              { installationId: pending.id, manifestUrl: each.manifestUrl },
              deadline
            )
          : installFrom(
              store,
              { failed: pending, manifest, manifestUrl: each.manifestUrl },
              deadline
            );
      }

      const done = toInstall.map((each) => each.name);

      return {
        data: {
          created: done.length > 0,
          installed: done,
          removed: removedNames,
          store: store.instance.ref,
        },
        headline: changes
          ? [
              done.length > 0 ? `Installed ${done.join(", ")}` : "",
              removedNames.length > 0
                ? `Uninstalled ${removedNames.join(", ")}`
                : "",
            ]
              .filter(Boolean)
              .join("; ")
              .concat(` on ${store.instance.ref}.`)
          : `${store.instance.ref} already has the App Store apps asked for.`,
        text: "",
      } satisfies Ensured<StoreAppsResult>;
    });

    return {
      action,
      apply,
      details: {
        install: manifests.map(({ each, manifest }) => ({
          id: each.id,
          manifestUrl: each.manifestUrl,
          name: each.name,
          permissions: manifest.permissions,
        })),
        remove: removedNames,
      },
      risk:
        toRemove.length > 0
          ? `Uninstalling ${removedNames.join(", ")} deletes their webhooks, tokens and settings on the store.`
          : null,
      state: changes ? "absent" : "exists",
      summary: [
        ...manifests.map(
          ({ each, manifest }) =>
            [
              `Install ${each.name}`,
              manifest.permissions.join(", ") || "no permissions",
            ] as const
        ),
        ...removedNames.map((name) => [`Uninstall ${name}`, ""] as const),
      ],
      target: {
        id: null,
        name: "App Store apps",
        scope: { store: store.instance.ref },
        type: "apps",
      },
    } satisfies Planned<Ensured<StoreAppsResult>, unknown>;
  });
