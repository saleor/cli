// What a running Saleor instance looks like in command output.
export interface Target {
  readonly dashboardUrl: string | null;
  readonly graphqlUrl: string;
  readonly kind: string;
  readonly name: string;
  readonly ref: string;
  readonly saleorVersion: string | null;
}

export const targetData = (target: Target) => target;
