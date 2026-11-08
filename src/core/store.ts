import { Context, type Effect, type Option } from "effect";
import type { Ensured, Planned } from "./action.ts";
import type { CliFailure } from "./errors.ts";

// What a Saleor store looks like in command output, wherever it runs. Every command
// that shows a store (a Cloud environment or a local one in Docker) returns these fields,
// so a script can read any of them the same way; provider-specific fields sit next to
// them, flat, and `kind` says which ones to expect.
//
// `state` says what is known about the store:
//   ready        its GraphQL API answered during this command
//   running      the provider reports it running; the API was not contacted
//   starting     it is running but the API does not answer yet
//   busy         Saleor Cloud is running a task on it (setup, upgrade, deletion)
//   maintenance  Saleor Cloud switched it off for maintenance
//   stopped      its containers are stopped (local)
//   incomplete   its first setup did not finish (local)
export const STORE_STATES = [
  "ready",
  "running",
  "starting",
  "busy",
  "maintenance",
  "stopped",
  "incomplete",
] as const;

export type StoreState = (typeof STORE_STATES)[number];

// Whether the store runs, as far as is known: its API answered, or its provider says
// it runs and the API was not asked.
export const isRunning = (state: StoreState) =>
  state === "ready" || state === "running";

export interface Store {
  readonly dashboardUrl: string;
  readonly graphqlUrl: string;
  readonly kind: "cloud" | "local";
  readonly name: string;
  // `ready` is `state === "ready"`, for scripts that only need a yes or no.
  readonly ready: boolean;
  // Stable identifier: `cloud:<org>/<environment key>` or `local:<name>`.
  readonly ref: string;
  readonly saleorVersion: string | null;
  readonly state: StoreState;
}

export const storeFrom = (fields: Omit<Store, "ready">): Store => ({
  ...fields,
  ready: fields.state === "ready",
});

// What `env start` passes to the source that runs the store.
export interface StartOptions {
  // Local stores: move to new free ports, for when another program took one.
  readonly newPorts: boolean;
  readonly timeout: number;
}

// A store that `env start` made ready, with whether this run created it.
export type Started = Store & { readonly created: boolean };

// A copy of a store's data, kept by the place the store runs, that the store (or
// another one there) can be restored from.
export interface Backup {
  readonly createdAt: string;
  // The name of the store it was made from; null once that store is deleted.
  readonly environment: string | null;
  // Stable identifier, unique where backups are kept.
  readonly id: string;
  readonly name: string;
  readonly saleorVersion: string;
  // How it was made: manual, automated…
  readonly type: string;
}

// A backup that `backup add` made sure exists, with whether this run made it.
export type BackupAdded = Backup & { readonly created: boolean };

// A store that `backup restore` replaced the data of, and the backup it came from.
export type Restored = Store & {
  readonly backup: Backup;
  readonly created: false;
};

// What a source that keeps backups offers. Planning only reads.
export interface BackupSource<R> {
  // The backups made from the store.
  readonly list: (
    id: string
  ) => Effect.Effect<readonly Backup[], CliFailure, R>;
  // Every backup the store can be restored from, or that can be deleted alongside
  // it: in Saleor Cloud, all of its organization's, including other environments'.
  readonly available: (
    id: string
  ) => Effect.Effect<readonly Backup[], CliFailure, R>;
  readonly add: (
    id: string,
    name: string,
    options: { readonly timeout: number }
  ) => Effect.Effect<Planned<Ensured<BackupAdded>, R>, CliFailure, R>;
  readonly remove: (
    id: string,
    backup: Backup
  ) => Effect.Effect<Planned<object, R>, CliFailure, R>;
  // Replaces the store's data with the backup's.
  readonly restore: (
    id: string,
    backup: Backup,
    options: { readonly timeout: number }
  ) => Effect.Effect<Planned<Ensured<Restored>, R>, CliFailure, R>;
}

// Where stores of one kind come from: the adapter between the CLI's one set of
// environment commands and a place stores run. Each module that runs stores
// contributes one, so `env list`, `env start`, a storefront connecting to a store and
// the rest work with any store without knowing which modules exist. A source offers
// the lifecycle steps it can carry out; `env` refuses the others with a usage error.
// See core/stores.ts and core/environments.ts.
export interface StoreSource<R> {
  // The store with this id (the part of its ref after `<kind>:`), if it exists.
  // Backups of its stores, when the source keeps them.
  readonly backups?: BackupSource<R>;
  readonly find: (
    id: string
  ) => Effect.Effect<Option.Option<Store>, CliFailure, R>;
  readonly kind: Store["kind"];
  // How a person knows where they run: "Saleor Cloud", "Docker".
  readonly label: string;
  readonly list: Effect.Effect<readonly Store[], CliFailure, R>;
  // Offered instead of the list when listing needs a login (AUTH_REQUIRED).
  readonly login?: Effect.Effect<void, CliFailure, R>;
  // Loads Saleor's sample data (products, orders, customers) into the store, when the
  // source can. It replaces what the store holds, so only new stores are offered it.
  readonly populate?: (store: Store) => Effect.Effect<void, CliFailure, R>;
  // Plans deleting the store and its data. Planning only reads.
  readonly remove?: (
    id: string,
    options: { readonly timeout: number }
  ) => Effect.Effect<Planned<object, R>, CliFailure, R>;
  // A staff user's token, for what Saleor lets only a person do: installing and
  // creating apps (appInstall, appCreate), which an app token cannot. A local store
  // logs in as its admin; a Cloud store takes the Cloud login. None when it cannot.
  readonly staffToken?: (
    store: Store
  ) => Effect.Effect<Option.Option<string>, CliFailure, R>;
  // Plans starting the store, creating it first when the project defines it but this
  // computer does not have it yet.
  readonly start?: (
    id: string,
    options: StartOptions
  ) => Effect.Effect<Planned<Ensured<Started>, R>, CliFailure, R>;
  // Plans stopping the store, keeping its data.
  readonly stop?: (
    id: string
  ) => Effect.Effect<Planned<object, R>, CliFailure, R>;
  // A token for the store's own API, when the source can get one without asking (a
  // local store logs in as the admin the CLI created). None when it cannot.
  readonly token?: (
    store: Store
  ) => Effect.Effect<Option.Option<string>, CliFailure, R>;
}

// The lifecycle steps a source may offer.
export type Lifecycle = "remove" | "start" | "stop";

// What a command can ask of a source: a lifecycle step, or its backups.
export type Capability = Lifecycle | "backups";

export class StoreSources extends Context.Service<
  StoreSources,
  readonly StoreSource<never>[]
>()("saleor/StoreSources") {}
