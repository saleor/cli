import {
  type Document,
  documentsIn,
  identity,
  type Json,
  nameOf,
  textOf,
} from "./document.ts";
import type { Change } from "./engine.ts";

// Configurations and changes in words, so a person reviews what a store will have
// instead of reading YAML.

const entries = (config: Document, section: string) =>
  documentsIn(config[section]);

const list = (names: readonly string[], max = 6) =>
  names.length <= max
    ? names.join(", ")
    : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

const flatten = (categories: readonly Document[]): string[] =>
  categories.flatMap((category) => [
    nameOf(category),
    ...flatten(entries(category, "subcategories")).map(
      (child) => `${nameOf(category)} › ${child}`
    ),
  ]);

// Attribute references (`- attribute: Brand`) or, in older files, inline ones.
const referenced = (value: Json | undefined) =>
  documentsIn(value).map((item) => textOf(item.attribute) ?? nameOf(item));

// Labelled rows describing a configuration: what a person checks before deploying.
export const review = (config: Document) => {
  const rows: [string, string][] = [];

  const add = (label: string, values: readonly string[]) => {
    if (values.length > 0) {
      rows.push([label, list(values)]);
    }
  };

  add(
    "Channels",
    entries(config, "channels").map(
      (channel) => `${nameOf(channel)} (${textOf(channel.currencyCode) ?? "?"})`
    )
  );
  add("Warehouses", entries(config, "warehouses").map(nameOf));
  add(
    "Shipping",
    entries(config, "shippingZones").map((zone) => {
      const methods = entries(zone, "shippingMethods").map(nameOf);

      return methods.length > 0
        ? `${nameOf(zone)}: ${methods.join(", ")}`
        : nameOf(zone);
    })
  );
  add(
    "Product types",
    entries(config, "productTypes").map((type) => {
      const product = referenced(type.productAttributes);
      const variant = referenced(type.variantAttributes);

      const details = [
        ...product,
        ...(variant.length > 0 ? [`variants by ${variant.join(" and ")}`] : []),
      ];

      return details.length > 0
        ? `${nameOf(type)} (${details.join(", ")})`
        : nameOf(type);
    })
  );
  add("Categories", flatten(entries(config, "categories")));
  add("Collections", entries(config, "collections").map(nameOf));

  const products = entries(config, "products");

  if (products.length > 0) {
    rows.push([
      "Products",
      `${products.length}: ${list(products.map(nameOf), 4)}`,
    ]);
  }

  add(
    "Menus",
    entries(config, "menus")
      .filter((menu) => entries(menu, "items").length > 0)
      .map(
        (menu) =>
          `${nameOf(menu)} (${list(entries(menu, "items").map(nameOf), 4)})`
      )
  );

  return rows;
};

const SINGULAR = new Map([
  ["Categories", "category"],
  ["Channels", "channel"],
  ["Collections", "collection"],
  ["Content Attributes", "content attribute"],
  ["Customer Attributes", "customer attribute"],
  ["Customer Types", "customer type"],
  ["Menus", "menu"],
  ["Model Types", "model type"],
  ["Models", "model"],
  ["Page Types", "page type"],
  ["Product Attributes", "attribute"],
  ["Product Types", "product type"],
  ["Products", "product"],
  ["Shipping Zones", "shipping zone"],
  ["Shop Settings", "shop settings"],
  ["TaxClasses", "tax class"],
  ["Warehouses", "warehouse"],
]);

export const noun = (entity: string) => SINGULAR.get(entity) ?? entity;

// The fields that change, by their top-level name: "settings", not 11 settings.
const fields = (change: Change) => {
  const names = [
    ...new Set(change.fields.map((field) => field.split(".")[0] ?? field)),
  ];

  return names.length > 0 ? ` (${list(names, 4)})` : "";
};

// A change as a sentence about the store: "Create product type "Shirt"".
export const sentence = (change: Change) => {
  const what =
    change.entity === "Shop Settings"
      ? "shop settings"
      : `${noun(change.entity)} "${change.name}"`;

  const verb = { create: "Create", delete: "Delete", update: "Update" }[
    change.operation
  ];

  return `${verb} ${what}${fields(change)}`;
};

// The same difference seen from the file: what pulling would bring in.
export const pulledSentence = (change: Change) => {
  const what =
    change.entity === "Shop Settings"
      ? "Shop settings"
      : `${noun(change.entity)} "${change.name}"`;

  switch (change.operation) {
    case "create": {
      return `${what} is gone from the store; pulling removes it from the file`;
    }

    case "delete": {
      return `The store has ${what} that the file does not; pulling adds it`;
    }

    case "update": {
      return `${what} changed in the store${fields(change)}`;
    }
  }
};

// What the engine does with each kind of difference, from Configurator 3.23.2's
// services and from deploying: it never deletes a top-level entity, and of a
// category's changes it only adds subcategories (no renames). Plans leave the rest
// out instead of promising it; deploys compare again afterwards in any case.
export const applies = (change: Change) => {
  if (change.operation === "delete") {
    return false;
  }

  return (
    change.operation === "create" ||
    change.entity !== "Categories" ||
    change.fields.every((field) => field.startsWith("subcategories"))
  );
};

export const why = (change: Change) =>
  change.operation === "delete"
    ? "deploys never delete; remove it in the Dashboard"
    : "Configurator does not rename categories; change it in the Dashboard";

const SECTION_NOUN = new Map([
  ["categories", "category"],
  ["channels", "channel"],
  ["collections", "collection"],
  ["contentAttributes", "content attribute"],
  ["customerAttributes", "customer attribute"],
  ["customerTypes", "customer type"],
  ["menus", "menu"],
  ["models", "model"],
  ["modelTypes", "model type"],
  ["pageTypes", "page type"],
  ["productAttributes", "attribute"],
  ["products", "product"],
  ["productTypes", "product type"],
  ["shippingZones", "shipping zone"],
  ["taxClasses", "tax class"],
  ["warehouses", "warehouse"],
]);

const keyed = (items: readonly Document[]) =>
  new Map(items.map((item) => [identity(item), item]));

const sectionChanges = (before: Document, after: Document, section: string) => {
  const lines: string[] = [];
  const old = keyed(entries(before, section));
  const next = keyed(entries(after, section));
  const what = SECTION_NOUN.get(section) ?? section;

  for (const [id, item] of next) {
    const previous = old.get(id);

    if (previous === undefined) {
      lines.push(`Adds ${what} "${nameOf(item)}"`);
    } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
      lines.push(`Changes ${what} "${nameOf(item)}"`);
    }
  }

  for (const [id, item] of old) {
    if (!next.has(id)) {
      lines.push(`Removes ${what} "${nameOf(item)}" from the file`);
    }
  }

  return lines;
};

// What an edit changes in the file, entry by entry: "Adds product type "Jacket"".
export const fileChanges = (before: Document, after: Document) => {
  const lines: string[] = [];
  const sections = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const section of sections) {
    if (section === "shop") {
      if (JSON.stringify(before.shop) !== JSON.stringify(after.shop)) {
        lines.push("Changes shop settings");
      }

      continue;
    }

    lines.push(...sectionChanges(before, after, section));
  }

  return lines;
};
