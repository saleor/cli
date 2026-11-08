import { Data, Effect, Schema } from "effect";
import { converge, done, failWith, wait } from "../../core/converge.ts";
import { fail } from "../../core/errors.ts";
import { type Deadline, notReady } from "../../core/readiness.ts";
import {
  mutationRejected,
  MutationErrors,
  PermissionCodes,
  type StoreClient,
  storeData,
} from "../../core/store-api.ts";

// Apps installed on a store, through the store's own GraphQL API. Saleor installs an
// app from its manifest URL in a background job: `appInstall` starts an installation,
// which is deleted once the app exists, or kept with status FAILED and a message.

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
        permissions: Schema.NullOr(PermissionCodes),
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

const METADATA = `query($id: ID!) {
  app(id: $id) { metadata { key value } privateMetadata { key value } }
}`;

const UPDATE_METADATA = `mutation($id: ID!, $input: [MetadataInput!]!) {
  updated: updateMetadata(id: $id, input: $input) { errors { field message } }
}`;

const UPDATE_PRIVATE_METADATA = `mutation($id: ID!, $input: [MetadataInput!]!) {
  updated: updatePrivateMetadata(id: $id, input: $input) { errors { field message } }
}`;

// The apps on the store, and installations that have not finished or have failed.
export const appsOn = (client: StoreClient) =>
  Effect.map(storeData(client, Apps, { query: APPS }), (data) => ({
    apps: data.apps.edges.map((edge) => edge.node),
    installations: data.appsInstallations,
  }));

// What the app asks for, read by the store from its manifest URL, as installing does.
export const fetchManifest = (client: StoreClient, manifestUrl: string) =>
  Effect.gen(function* () {
    const { appFetchManifest: answer } = yield* storeData(client, Manifest, {
      query: FETCH_MANIFEST,
      variables: { manifestUrl },
    });

    if (answer.manifest === null) {
      return yield* mutationRejected(
        client.store,
        `read the manifest at ${manifestUrl}`,
        [...answer.errors]
      );
    }

    return {
      identifier: answer.manifest.identifier,
      name: answer.manifest.name,
      permissions: (answer.manifest.permissions ?? []).map((each) => each.code),
    };
  });

const started = (client: StoreClient, answer: typeof Started.Type) =>
  answer.started.appInstallation === null
    ? Effect.fail(
        mutationRejected(client.store, "install the app", answer.started.errors)
      )
    : Effect.succeed(answer.started.appInstallation.id);

export const install = (
  client: StoreClient,
  app: {
    readonly manifestUrl: string;
    readonly name: string;
    readonly permissions: readonly string[];
  }
) =>
  Effect.flatMap(
    storeData(client, Started, {
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
    (answer) => started(client, answer)
  );

export const retryInstall = (client: StoreClient, installationId: string) =>
  Effect.flatMap(
    storeData(client, Started, {
      query: RETRY,
      variables: { id: installationId },
    }),
    (answer) => started(client, answer)
  );

// ── Installation state ───────────────────────────────────────────────────

// Saleor's status of an installation the CLI started. The only place that reads it.
export const installationFailed = (installation: Installation) =>
  installation.status === "FAILED";

// How an installation stands, seen from the store's apps and installations.
//   Installed   the app with its manifest URL exists
//   Installing  Saleor is still working on it (or finished and the app is not listed yet)
//   Failed      Saleor gave up, with a message
//   Lost        the installation is gone, yet no app has its manifest URL
export type InstallState = Data.TaggedEnum<{
  Failed: { readonly installation: Installation };
  Installed: { readonly app: InstalledApp };
  Installing: { readonly installation: Installation | undefined };
  Lost: { readonly manifestUrl: string };
}>;

export const InstallState = Data.taggedEnum<InstallState>();

export const classifyInstall = (
  seen: {
    readonly apps: readonly InstalledApp[];
    readonly installations: readonly Installation[];
  },
  wanted: { readonly installationId: string; readonly manifestUrl: string }
): InstallState => {
  const pending = seen.installations.find(
    (each) => each.id === wanted.installationId
  );

  if (pending !== undefined && installationFailed(pending)) {
    return InstallState.Failed({ installation: pending });
  }

  if (pending === undefined || pending.status === "SUCCESS") {
    const app = seen.apps.find(
      (each) => each.manifestUrl === wanted.manifestUrl
    );

    if (app !== undefined) {
      return InstallState.Installed({ app });
    }

    if (pending === undefined) {
      return InstallState.Lost({ manifestUrl: wanted.manifestUrl });
    }
  }

  return InstallState.Installing({ installation: pending });
};

export const decideInstall = (ref: string) =>
  InstallState.$match({
    Failed: ({ installation }) =>
      failWith(
        fail(
          "STORE_ERROR",
          `${ref} could not install ${installation.appName}: ${installation.message ?? "no reason given"}`,
          {
            details: { installation },
            suggestion:
              "Check that the store can reach the manifest URL and the app's endpoints, then run the same command again to retry.",
          }
        )
      ),
    Installed: ({ app }) => done(app),
    Installing: () => wait("installing the app"),
    Lost: ({ manifestUrl }) =>
      failWith(
        fail(
          "STORE_ERROR",
          `${ref} finished installing from ${manifestUrl}, but no app has that manifest URL.`
        )
      ),
  });

// Waits until the installation is gone and the app with its manifest URL exists.
export const installed = (
  client: StoreClient,
  wanted: { readonly installationId: string; readonly manifestUrl: string },
  deadline: Deadline
) =>
  converge({
    deadline,
    decide: decideInstall(client.store.ref),
    observe: Effect.map(appsOn(client), (seen) =>
      classifyInstall(seen, wanted)
    ),
    timeout: (state) =>
      notReady(
        `${client.store.ref} is still installing the app.`,
        {
          installation: InstallState.$is("Installing")(state)
            ? (state.installation ?? null)
            : null,
        },
        "the store"
      ),
  });

export type Manifest = Effect.Success<ReturnType<typeof fetchManifest>>;

// Whether the store can read the manifest of an app it has installed: Saleor refuses
// to read one whose app is installed already (identifier: UNIQUE), which still means
// it reached the manifest. Any other refusal is the failure.
export const canReadManifest = (client: StoreClient, manifestUrl: string) =>
  Effect.gen(function* () {
    const { appFetchManifest: answer } = yield* storeData(client, Manifest, {
      query: FETCH_MANIFEST,
      variables: { manifestUrl },
    });

    const others = answer.errors.filter(
      (error) => !(error.field === "identifier" && error.code === "UNIQUE")
    );

    if (answer.manifest === null && others.length > 0) {
      return yield* mutationRejected(
        client.store,
        `read the manifest at ${manifestUrl}`,
        [...others]
      );
    }
  });

// Installs from a manifest the store has read, or retries an installation that
// failed, then waits for the app.
export const installFrom = (
  client: StoreClient,
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
        ? yield* install(client, {
            ...app.manifest,
            manifestUrl: app.manifestUrl,
          })
        : yield* retryInstall(client, app.failed.id);

    return yield* installed(
      client,
      { installationId, manifestUrl: app.manifestUrl },
      deadline
    );
  });

export type Metadata = typeof Entries.Type;

export const metadataOf = (client: StoreClient, id: string) =>
  Effect.map(
    storeData(client, AppMetadata, { query: METADATA, variables: { id } }),
    (data) => ({
      metadata: data.app?.metadata ?? [],
      privateMetadata: data.app?.privateMetadata ?? [],
    })
  );

export const writeMetadata = (
  client: StoreClient,
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
            storeData(client, MetadataUpdated, {
              query: mutation,
              variables: { id, input: entries.map((each) => ({ ...each })) },
            }),
            ({ updated }) =>
              updated.errors.length > 0
                ? Effect.fail(
                    mutationRejected(
                      client.store,
                      "copy the app's metadata",
                      updated.errors
                    )
                  )
                : Effect.void
          ),
    { discard: true }
  );
