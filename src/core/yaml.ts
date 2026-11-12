import { Option, Schema } from "effect";
import { parseDocument } from "yaml";

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

// YAML text as JSON-shaped data; none when it is not YAML.
export const parseYaml = (text: string): Option.Option<Schema.Json> => {
  try {
    return decodeJson(parseDocument(text).toJS());
  } catch {
    return Option.none();
  }
};

// YAML text through a schema; none when either rejects it.
export const decodeYaml = <A extends Schema.ConstraintDecoder<unknown>>(
  schema: A,
  text: string
): Option.Option<A["Type"]> =>
  Option.flatMap(parseYaml(text), Schema.decodeUnknownOption(schema));
