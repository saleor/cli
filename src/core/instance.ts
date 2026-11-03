import { Context, type Effect, type Option } from "effect";
import type { Ensured, Planned } from "./action.ts";
import type { CliFailure } from "./errors.ts";

// What a Saleor instance looks like in command output, wherever it runs. Every command
// that shows an instance (Cloud environment or local Docker stack) returns these fields,
// so a script can read any of them the same way; provider-specific fields sit next to
// them, flat, and `kind` says which ones to expect.
//
// `state` says what is known about the instance:
//   ready        its GraphQL API answered during this command
//   running      the provider reports it running; the API was not contacted
//   starting     it is running but the API does not answer yet
//   busy         Saleor Cloud is running a task on it (setup, upgrade, deletion)
//   maintenance  Saleor Cloud switched it off for maintenance
//   stopped      its containers are stopped (local)
//   incomplete   its first setup did not finish (local)
export const INSTANCE_STATES = [
  "ready",
  "running",
  "starting",
  "busy",
  "maintenance",
  "stopped",
  "incomplete",
] as const;

export type InstanceState = (typeof INSTANCE_STATES)[number];

export interface Instance {
  readonly dashboardUrl: string;
  readonly graphqlUrl: string;
  readonly kind: "cloud" | "local";
  readonly name: string;
  // `ready` is `state === "ready"`, for scripts that only need a yes or no.
  readonly ready: boolean;
  // Stable identifier: `cloud:<org>/<environment key>` or `local:<name>`.
  readonly ref: string;
  readonly saleorVersion: string | null;
  readonly state: InstanceState;
}

export const instance = (fields: Omit<Instance, "ready">): Instance => ({
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
export type Started = Instance & { readonly created: boolean };

// Where instances of one kind come from: the adapter between the CLI's one set of
// environment commands and a place stores run. Each module that runs stores
// contributes one, so `env list`, `env start`, a storefront connecting to a store and
// the rest work with any store without knowing which modules exist. A source offers
// the lifecycle steps it can carry out; `env` refuses the others with a usage error.
// See core/instances.ts and core/environments.ts.
export interface InstanceSource<R> {
  // A token for the store's own API, when the source can get one without asking (a
  // local instance signs in with the admin the CLI created). None when it cannot.
  readonly access?: (
    instance: Instance
  ) => Effect.Effect<Option.Option<string>, CliFailure, R>;
  // A staff user's token, for what Saleor lets only a person do: installing and
  // creating apps (appInstall, appCreate), which an app token cannot. A local instance
  // signs in as its admin; a Cloud store takes the Cloud login. None when it cannot.
  readonly staffAccess?: (
    instance: Instance
  ) => Effect.Effect<Option.Option<string>, CliFailure, R>;
  // The instance with this id (the part of its ref after `<kind>:`), if it exists.
  readonly find: (
    id: string
  ) => Effect.Effect<Option.Option<Instance>, CliFailure, R>;
  readonly kind: Instance["kind"];
  // How a person knows where they run: "Saleor Cloud", "Docker".
  readonly label: string;
  readonly list: Effect.Effect<readonly Instance[], CliFailure, R>;
  // Loads Saleor's sample data (products, orders, customers) into the store, when the
  // source can. It replaces what the store holds, so only new stores are offered it.
  readonly populate?: (
    instance: Instance
  ) => Effect.Effect<void, CliFailure, R>;
  // Plans deleting the store and its data. Planning only reads.
  readonly remove?: (
    id: string,
    options: { readonly timeout: number }
  ) => Effect.Effect<Planned<object, R>, CliFailure, R>;
  // Offered instead of the list when listing needs a login (AUTH_REQUIRED).
  readonly signIn?: Effect.Effect<void, CliFailure, R>;
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
}

// The lifecycle steps a source may offer.
export type Lifecycle = "remove" | "start" | "stop";

export class InstanceSources extends Context.Service<
  InstanceSources,
  readonly InstanceSource<never>[]
>()("saleor/InstanceSources") {}
