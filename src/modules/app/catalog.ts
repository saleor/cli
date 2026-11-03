import { Duration, Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { fail } from "../../core/errors.ts";

// The Saleor App Store: the list the Dashboard shows under Extensions, from
// apps.saleor.io (the Dashboard's EXTENSIONS_API_URL). Only apps with a manifest URL
// can be installed through the API; plugins are configured in the Dashboard, and some
// apps are installed by Saleor's team, so neither is offered here.

const TRAILING_SLASHES = /\/+$/;

export const catalogUrl = (env: NodeJS.ProcessEnv = process.env) =>
  (
    env.SALEOR_EXTENSIONS_URL ?? "https://apps.saleor.io/api/v1/extensions"
  ).replace(TRAILING_SLASHES, "");

const Text = Schema.Struct({ en: Schema.String });

const Catalog = Schema.Struct({
  extensionCategories: Schema.Array(
    Schema.Struct({
      extensions: Schema.Array(
        Schema.Struct({
          description: Schema.optionalKey(Schema.NullOr(Text)),
          id: Schema.String,
          manifestUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
          name: Text,
          type: Schema.String,
        })
      ),
      id: Schema.String,
      name: Text,
    })
  ),
});

export interface StoreApp {
  readonly category: string;
  readonly description: string | null;
  readonly id: string;
  readonly manifestUrl: string;
  readonly name: string;
  // Other App Store entries that install the same app, such as one CMS app for
  // Strapi, Contentful and others.
  readonly providers: readonly string[];
}

const unreachable = () =>
  fail(
    "NETWORK_ERROR",
    `Could not read the Saleor App Store at ${catalogUrl()}.`,
    {
      retry: true,
      suggestion:
        "Check your internet connection, or install the app by its manifest URL with --manifest <url>.",
    }
  );

// Entries that share a manifest URL are one app: shown once, named after their
// category, with the entries as its providers.
const group = (catalog: typeof Catalog.Type): readonly StoreApp[] => {
  const apps = new Map<string, StoreApp>();

  for (const category of catalog.extensionCategories) {
    for (const entry of category.extensions) {
      const url = entry.manifestUrl;

      if (entry.type !== "APP" || url === undefined || url === null) {
        continue;
      }

      const seen = apps.get(url);

      apps.set(
        url,
        seen === undefined
          ? {
              category: category.name.en,
              description: entry.description?.en ?? null,
              id: entry.id,
              manifestUrl: url,
              name: entry.name.en,
              providers: [entry.name.en],
            }
          : {
              ...seen,
              description: null,
              name: category.name.en,
              providers: [...seen.providers, entry.name.en],
            }
      );
    }
  }

  return [...apps.values()].map((each) =>
    each.providers.length > 1
      ? { ...each, name: `${each.name} (${each.providers.join(", ")})` }
      : each
  );
};

export const storeApps = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;

  const response = yield* http
    .execute(
      HttpClientRequest.get(catalogUrl()).pipe(HttpClientRequest.acceptJson)
    )
    .pipe(Effect.timeout(Duration.seconds(30)), Effect.mapError(unreachable));

  if (response.status !== 200) {
    return yield* unreachable();
  }

  const catalog = yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Catalog)),
    Effect.mapError(() =>
      fail(
        "API_ERROR",
        "The Saleor App Store sent a list this version of the CLI does not understand."
      )
    )
  );

  return group(catalog);
});

const words = (text: string) => text.toLowerCase().trim();

// What a person may type for an app: its id (saleor.app.avatax), the id's last part
// (avatax), or its name or a provider's (Avatax, Strapi CMS), in any case.
const names = (each: StoreApp) => [
  each.id,
  each.id.split(".").at(-1) ?? each.id,
  each.name,
  ...each.providers,
];

export const resolveStoreApps = (
  catalog: readonly StoreApp[],
  wanted: readonly string[]
) =>
  Effect.forEach(wanted, (word) => {
    const found = catalog.filter((each) =>
      names(each).some((name) => words(name) === words(word))
    );

    if (found.length === 1 && found[0] !== undefined) {
      return Effect.succeed(found[0]);
    }

    return Effect.fail(
      fail(
        "USAGE_ERROR",
        found.length === 0
          ? `"${word}" is not an app in the Saleor App Store that can be installed here.`
          : `"${word}" names ${found.length} App Store apps.`,
        {
          suggestion:
            "See the apps and their ids with: saleor app list --store-apps",
        }
      )
    );
  });
