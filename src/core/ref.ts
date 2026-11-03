// A store's ref: `<kind>:<id>`, the stable name every command prints and accepts.
// Local stores are `local:<name>`; Cloud stores `cloud:<org>/<environment key>`.

export const REF = /^[a-z]+:.+$/;

export const kindOf = (ref: string) => ref.slice(0, ref.indexOf(":"));

// The part after `<kind>:`, which the store's source knows it by.
export const idOf = (ref: string) => ref.slice(ref.indexOf(":") + 1);

export const localRef = (name: string) => `local:${name}`;

export const cloudRef = (organization: string, key: string) =>
  `cloud:${organization}/${key}`;
