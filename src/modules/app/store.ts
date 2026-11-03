import { Effect, Schema } from "effect";
import { fail } from "../../core/errors.ts";
import type { Instance } from "../../core/instance.ts";
import { type Deadline, isPast, notReady, POLL } from "../../core/readiness.ts";
import { storeQuery } from "../../core/store-api.ts";

// Apps installed on a store, through the store's own GraphQL API. Saleor installs an
// app from its manifest URL in a background job: `appInstall` starts an installation,
// which is deleted once the app exists, or kept with status FAILED and a message.

export interface Store {
  readonly instance: Instance;
  readonly token: string;
}

const Codes = Schema.Array(Schema.Struct({ code: Schema.String }));

const MutationErrors = Schema.Array(
  Schema.Struct({
    code: Schema.optionalKey(Schema.NullOr(Schema.String)),
    field: Schema.NullOr(Schema.String),
    message: Schema.NullOr(Schema.String),
  })
);

const InstalledApp = Schema.Struct({
  id: Schema.String,
  identifier: Schema.NullOr(Schema.String),
  isActive: Schema.NullOr(Schema.Boolean),
  manifestUrl: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  type: Schema.NullOr(Schema.String),
});

export type InstalledApp = typeof InstalledApp.Type;

const Installation = Schema.Struct({
  appName: Schema.String,
  id: Schema.String,
  manifestUrl: Schema.String,
  message: Schema.NullOr(Schema.String),
  status: Schema.String,
});

export type Installation = typeof Installation.Type;

const Apps = Schema.Struct({
  apps: Schema.Struct({
    edges: Schema.Array(Schema.Struct({ node: InstalledApp })),
  }),
  appsInstallations: Schema.Array(Installation),
});

const Manifest = Schema.Struct({
  appFetchManifest: Schema.Struct({
    errors: MutationErrors,
    manifest: Schema.NullOr(
      Schema.Struct({
        identifier: Schema.NullOr(Schema.String),
        name: Schema.String,
        permissions: Schema.NullOr(Codes),
      })
    ),
  }),
});

const Started = Schema.Struct({
  started: Schema.Struct({
    appInstallation: Schema.NullOr(Schema.Struct({ id: Schema.String })),
    errors: MutationErrors,
  }),
});

const Deleted = Schema.Struct({
  appDelete: Schema.Struct({ errors: MutationErrors }),
});

const Entries = Schema.Array(
  Schema.Struct({ key: Schema.String, value: Schema.String })
);

const AppMetadata = Schema.Struct({
  app: Schema.NullOr(
    Schema.Struct({ metadata: Entries, privateMetadata: Entries })
  ),
});

const MetadataUpdated = Schema.Struct({
  updated: Schema.Struct({ errors: MutationErrors }),
});

const APPS = `query {
  apps(first: 100) { edges { node { id name identifier manifestUrl isActive type } } }
  appsInstallations { id appName manifestUrl status message }
}`;

const FETCH_MANIFEST = `mutation($manifestUrl: String!) {
  appFetchManifest(manifestUrl: $manifestUrl) {
    manifest { name identifier permissions { code } }
    errors { field message code }
  }
}`;

const INSTALL = `mutation($input: AppInstallInput!) {
  started: appInstall(input: $input) { appInstallation { id } errors { field message } }
}`;

const RETRY = `mutation($id: ID!) {
  started: appRetryInstall(id: $id) { appInstallation { id } errors { field message } }
}`;

const DELETE = `mutation($id: ID!) {
  appDelete(id: $id) { errors { field message } }
}`;

const METADATA = `query($id: ID!) {
  app(id: $id) { metadata { key value } privateMetadata { key value } }
}`;

const UPDATE_METADATA = `mutation($id: ID!, $input: [MetadataInput!]!) {
  updated: updateMetadata(id: $id, input: $input) { errors { field message } }
}`;

const UPDATE_PRIVATE_METADATA = `mutation($id: ID!, $input: [MetadataInput!]!) {
  updated: updatePrivateMetadata(id: $id, input: $input) { errors { field message } }
}`;

const query = <S extends Schema.Top>(
  store: Store,
  schema: S,
  request: { readonly query: string; readonly variables?: Schema.JsonObject }
) =>
  storeQuery(store.instance, { ...request, token: store.token }).pipe(
    Effect.flatMap((data) =>
      Schema.decodeUnknownEffect(schema)(data).pipe(
        Effect.mapError(() =>
          fail(
            "STORE_ERROR",
            `${store.instance.ref} answered in a shape this CLI does not know.`
          )
        )
      )
    )
  );

type Errors = typeof MutationErrors.Type;

const rejected = (store: Store, what: string, errors: Errors) =>
  fail(
    "STORE_ERROR",
    `${store.instance.ref} did not ${what}: ${errors
      .map((error) => [error.field, error.message].filter(Boolean).join(": "))
      .join("; ")}`,
    { details: { errors } }
  );

// The apps on the store, and installations that have not finished or have failed.
export const appsOn = (store: Store) =>
  Effect.map(query(store, Apps, { query: APPS }), (data) => ({
    apps: data.apps.edges.map((edge) => edge.node),
    installations: data.appsInstallations,
  }));

// What the app asks for, read by the store from its manifest URL, as installing does.
export const fetchManifest = (store: Store, manifestUrl: string) =>
  Effect.gen(function* () {
    const { appFetchManifest: answer } = yield* query(store, Manifest, {
      query: FETCH_MANIFEST,
      variables: { manifestUrl },
    });

    if (answer.manifest === null) {
      return yield* rejected(store, `read the manifest at ${manifestUrl}`, [
        ...answer.errors,
      ]);
    }

    return {
      identifier: answer.manifest.identifier,
      name: answer.manifest.name,
      permissions: (answer.manifest.permissions ?? []).map((each) => each.code),
    };
  });

const started = (store: Store, answer: typeof Started.Type) =>
  answer.started.appInstallation === null
    ? Effect.fail(rejected(store, "install the app", answer.started.errors))
    : Effect.succeed(answer.started.appInstallation.id);

export const install = (
  store: Store,
  app: {
    readonly manifestUrl: string;
    readonly name: string;
    readonly permissions: readonly string[];
  }
) =>
  Effect.flatMap(
    query(store, Started, {
      query: INSTALL,
      variables: {
        input: {
          activateAfterInstallation: true,
          appName: app.name,
          manifestUrl: app.manifestUrl,
          permissions: [...app.permissions],
        },
      },
    }),
    (answer) => started(store, answer)
  );

export const retryInstall = (store: Store, installationId: string) =>
  Effect.flatMap(
    query(store, Started, { query: RETRY, variables: { id: installationId } }),
    (answer) => started(store, answer)
  );

// Waits until the installation is gone and the app with its manifest URL exists.
export const installed = (
  store: Store,
  {
    installationId,
    manifestUrl,
  }: { readonly installationId: string; readonly manifestUrl: string },
  deadline: Deadline
) =>
  Effect.gen(function* () {
    for (;;) {
      const { apps, installations } = yield* appsOn(store);
      const pending = installations.find((each) => each.id === installationId);

      if (pending?.status === "FAILED") {
        return yield* fail(
          "STORE_ERROR",
          `${store.instance.ref} could not install ${pending.appName}: ${pending.message ?? "no reason given"}`,
          {
            details: { installation: pending },
            suggestion:
              "Check that the store can reach the manifest URL and the app's endpoints, then run the same command again to retry.",
          }
        );
      }

      if (pending === undefined || pending.status === "SUCCESS") {
        const app = apps.find((each) => each.manifestUrl === manifestUrl);

        if (app !== undefined) {
          return app;
        }

        if (pending === undefined) {
          return yield* fail(
            "STORE_ERROR",
            `${store.instance.ref} finished installing from ${manifestUrl}, but no app has that manifest URL.`
          );
        }
      }

      if (isPast(deadline)) {
        return yield* notReady(
          `${store.instance.ref} is still installing the app.`,
          { installation: pending ?? null },
          "the store"
        );
      }

      yield* Effect.sleep(POLL);
    }
  });

export const uninstall = (store: Store, id: string) =>
  Effect.gen(function* () {
    const { appDelete } = yield* query(store, Deleted, {
      query: DELETE,
      variables: { id },
    });

    if (appDelete.errors.length > 0) {
      return yield* rejected(store, "delete the app", appDelete.errors);
    }
  });

export type Manifest = Effect.Success<ReturnType<typeof fetchManifest>>;

// Whether the store can read the manifest of an app it has installed: Saleor refuses
// to read one whose app is installed already (identifier: UNIQUE), which still means
// it reached the manifest. Any other refusal is the failure.
export const canReadManifest = (store: Store, manifestUrl: string) =>
  Effect.gen(function* () {
    const { appFetchManifest: answer } = yield* query(store, Manifest, {
      query: FETCH_MANIFEST,
      variables: { manifestUrl },
    });

    const others = answer.errors.filter(
      (error) => !(error.field === "identifier" && error.code === "UNIQUE")
    );

    if (answer.manifest === null && others.length > 0) {
      return yield* rejected(store, `read the manifest at ${manifestUrl}`, [
        ...others,
      ]);
    }
  });

// Installs from a manifest the store has read, or retries an installation that
// failed, then waits for the app.
export const installFrom = (
  store: Store,
  app: {
    readonly failed: Installation | undefined;
    readonly manifest: Manifest;
    readonly manifestUrl: string;
  },
  deadline: Deadline
) =>
  Effect.gen(function* () {
    const installationId =
      app.failed === undefined
        ? yield* install(store, {
            ...app.manifest,
            manifestUrl: app.manifestUrl,
          })
        : yield* retryInstall(store, app.failed.id);

    return yield* installed(
      store,
      { installationId, manifestUrl: app.manifestUrl },
      deadline
    );
  });

export type Metadata = typeof Entries.Type;

export const metadataOf = (store: Store, id: string) =>
  Effect.map(
    query(store, AppMetadata, { query: METADATA, variables: { id } }),
    (data) => ({
      metadata: data.app?.metadata ?? [],
      privateMetadata: data.app?.privateMetadata ?? [],
    })
  );

export const writeMetadata = (
  store: Store,
  id: string,
  {
    metadata,
    privateMetadata,
  }: { readonly metadata: Metadata; readonly privateMetadata: Metadata }
) =>
  Effect.forEach(
    [
      [UPDATE_METADATA, metadata],
      [UPDATE_PRIVATE_METADATA, privateMetadata],
    ] as const,
    ([mutation, entries]) =>
      entries.length === 0
        ? Effect.void
        : Effect.flatMap(
            query(store, MetadataUpdated, {
              query: mutation,
              variables: { id, input: entries.map((each) => ({ ...each })) },
            }),
            ({ updated }) =>
              updated.errors.length > 0
                ? Effect.fail(
                    rejected(store, "copy the app's metadata", updated.errors)
                  )
                : Effect.void
          ),
    { discard: true }
  );
