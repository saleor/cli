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
