import {
  type Document,
  documentsIn,
  identity,
  isDocument,
  type Json,
} from "./document.ts";

// A draft describes what a store should have; the store already has defaults (a
// default channel, warehouse, navbar menu). Merging lays the draft over the store's
// configuration: entries with the same slug (or name) are replaced, new ones added,
// and nothing is removed, so a deploy of the result never wants to delete anything.

const mergeList = (
  base: readonly Document[],
  over: readonly Document[]
): Document[] => {
  const merged = [...base];
  const index = new Map(merged.map((entry, i) => [identity(entry), i]));

  for (const entry of over) {
    const at = index.get(identity(entry));
    const existing = at === undefined ? undefined : merged[at];

    if (at === undefined || existing === undefined) {
      index.set(identity(entry), merged.length);
      merged.push(entry);
    } else {
      merged[at] = { ...existing, ...entry };
    }
  }

  return merged;
};

const mergeValue = (current: Json | undefined, value: Json): Json => {
  if (Array.isArray(value) && Array.isArray(current)) {
    return mergeList(documentsIn(current), documentsIn(value));
  }

  if (isDocument(value) && isDocument(current)) {
    return { ...current, ...value };
  }

  return value;
};

export const mergeConfig = (base: Document, over: Document): Document =>
  Object.fromEntries([
    ...Object.entries(base).filter(([section]) => !(section in over)),
    ...Object.entries(over).map(([section, value]) => [
      section,
      mergeValue(base[section], value),
    ]),
  ]);

// Saleor's defaults on a new 3.23 store, as `config pull` writes them, for drafting
// before the store exists. After it exists, its real configuration is merged instead.
export const NEW_STORE: Document = {
  categories: [{ name: "Default Category", slug: "default-category" }],
  channels: [
    {
      currencyCode: "USD",
      defaultCountry: "US",
      isActive: true,
      name: "Default Channel",
      slug: "default-channel",
    },
  ],
  menus: [
    { items: [], name: "navbar", slug: "navbar" },
    { items: [], name: "footer", slug: "footer" },
  ],
};

const orderList = (before: readonly Json[], next: readonly Json[]): Json[] => {
  const old = new Map(
    before.flatMap((entry, i) =>
      isDocument(entry) ? [[identity(entry), i] as const] : []
    )
  );

  return next
    .map((item, i) => {
      const at = isDocument(item) ? old.get(identity(item)) : undefined;

      return {
        at: at ?? before.length + i,
        item: at === undefined ? item : orderLike(before[at], item),
      };
    })
    .sort((a, b) => a.at - b.at)
    .map(({ item }) => item);
};

// `next` with the key and entry order of `before` wherever they share keys and
// entries, so an edited file's diff shows what changed, not a reshuffle.
export const orderLike = (before: Json | undefined, next: Json): Json => {
  if (Array.isArray(next)) {
    return Array.isArray(before) ? orderList(before, next) : next;
  }

  if (!(isDocument(next) && isDocument(before))) {
    return next;
  }

  const keys = [
    ...Object.keys(before).filter((key) => key in next),
    ...Object.keys(next).filter((key) => !(key in before)),
  ];

  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = next[key];

      return value === undefined ? [] : [[key, orderLike(before[key], value)]];
    })
  );
};

// The same for a whole document.
export const orderDocumentLike = (
  before: Document,
  next: Document
): Document => {
  const ordered = orderLike(before, next);

  return isDocument(ordered) ? ordered : next;
};
