import { type Option, Predicate, Schema } from "effect";
import { decodeYaml } from "../../core/yaml.ts";

// A config.yml as the CLI handles it: JSON-shaped data whose meaning (Configurator's
// schema) is the engine's to check. YAML becomes a document here, at the boundary;
// everything else works with these types.

export type Json = Schema.Json;

// A config.yml, or one of its entries (a channel, a product).
export type Document = Schema.JsonObject;

export const isJsonArray = (
  value: Json | undefined
): value is readonly Json[] => Array.isArray(value);

export const isDocument = (value: Json | undefined): value is Document =>
  Predicate.isObject(value) && !Array.isArray(value);

export const documentsIn = (value: Json | undefined): readonly Document[] =>
  isJsonArray(value) ? value.filter(isDocument) : [];

export const textOf = (value: Json | undefined) =>
  Predicate.isString(value) ? value : undefined;

// YAML text as a document; none when it is not YAML or not a mapping.
export const parseYamlDocument = (text: string): Option.Option<Document> =>
  decodeYaml(Schema.JsonObject, text);

// How Configurator identifies an entry: its slug, else its name.
export const identity = (entry: Document) => {
  const slug = textOf(entry.slug);

  return slug === undefined
    ? `name:${textOf(entry.name) ?? ""}`
    : `slug:${slug}`;
};

export const nameOf = (entry: Document) =>
  textOf(entry.name) ?? textOf(entry.slug) ?? "?";
