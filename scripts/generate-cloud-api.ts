// Generates Effect Schema contracts and operation descriptors for the Saleor Cloud API
// from schemas/cloud-api.openapi.json (copied from saleor-cloud-api, commit in
// schemas/cloud-api.source). Only the operations listed in OPERATIONS are emitted.
//
// Responses decode leniently: every property is optional unless the schema marks it
// required, unknown keys are dropped, and enums also accept any string so a new
// server-side enum value never breaks an old CLI. Requests are strict and never carry
// read-only fields.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface JsonSchema {
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  enum?: ReadonlyArray<string | null>;
  format?: string;
  items?: JsonSchema;
  nullable?: boolean;
  oneOf?: readonly JsonSchema[];
  properties?: Record<string, JsonSchema>;
  readOnly?: boolean;
  required?: readonly string[];
  type?: string;
}

interface Operation {
  operationId: string;
  parameters?: ReadonlyArray<{ name: string; in: string; required?: boolean }>;
  requestBody?: { content: Record<string, { schema: JsonSchema }> };
  responses: Record<
    string,
    { content?: Record<string, { schema: JsonSchema }> }
  >;
}

const OPERATIONS = [
  "retrieveUserWithOnboardingInfo",
  "listOrganizations",
  "retrieveOrganization",
  "listListProjects",
  "createCreateProject",
  "retrieveProject",
  "destroyProject",
  "listProjectServices",
  "listEnvironments",
  "createCreateEnvironment",
  "obtainPreheatedEnvironmentObtainEnvironment",
  "retrieveEnvironment",
  "destroyEnvironmentTask",
  "listEnvironmentTaskLists",
  "retrieveTaskStatus",
  "listPlans",
  "listRegions",
] as const;

const root = path.resolve(import.meta.dirname, "..");
const specPath = path.join(root, "schemas/cloud-api.openapi.json");
const outPath = path.join(root, "src/modules/cloud/api/generated.ts");

// SAFETY: the versioned snapshot comes from the Cloud OpenAPI exporter; the generator fails on missing schemas and generated contracts are typechecked.
const spec = JSON.parse(readFileSync(specPath, "utf8")) as {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, JsonSchema> };
};

const source = readFileSync(
  path.join(root, "schemas/cloud-api.source"),
  "utf8"
).trim();

// SAFETY: the checked-in overrides file is maintained alongside this generator with the notRequired string-list contract.
const overrides = JSON.parse(
  readFileSync(path.join(root, "schemas/cloud-api.overrides.json"), "utf8")
) as { notRequired: Record<string, readonly string[]> };

type Mode = "response" | "request";

const emitted = new Map<string, string>();
const order: string[] = [];

const refName = (ref: string) => ref.replace("#/components/schemas/", "");

const schemaName = (name: string, mode: Mode) =>
  mode === "request" ? `${name}Input` : name;

function emitComponent(name: string, mode: Mode): string {
  const id = schemaName(name, mode);

  if (!emitted.has(id)) {
    emitted.set(id, "");
    const schema = spec.components.schemas[name];

    if (!schema) {
      throw new Error(`Missing schema: ${name}`);
    }

    const notRequired = new Set(overrides.notRequired[name] ?? []);

    const body = render(
      {
        ...schema,
        required: (schema.required ?? []).filter(
          (key) => !notRequired.has(key)
        ),
      },
      mode
    );

    emitted.set(id, body);
    order.push(id);
  }

  return id;
}

function render(schema: JsonSchema, mode: Mode): string {
  if (schema.$ref) {
    return emitComponent(refName(schema.$ref), mode);
  }

  const base = renderBase(schema, mode);

  return schema.nullable || schema.enum?.includes(null)
    ? `Schema.NullOr(${base})`
    : base;
}

function renderBase(schema: JsonSchema, mode: Mode): string {
  if (schema.oneOf) {
    return `Schema.Union([${schema.oneOf.map((s) => render(s, mode)).join(", ")}])`;
  }

  if (schema.enum) {
    const values = schema.enum.filter((v): v is string => v !== null);
    const literals = `Schema.Literals(${JSON.stringify(values)})`;

    return mode === "response"
      ? `Schema.Union([${literals}, Schema.String])`
      : literals;
  }

  switch (schema.type) {
    case "string":
      return "Schema.String";
    case "integer":
      return "Schema.Int";
    case "number":
      return "Schema.Number";
    case "boolean":
      return "Schema.Boolean";
    case "array":
      return `Schema.Array(${schema.items ? render(schema.items, mode) : "Schema.Unknown"})`;
    case "object":
    case undefined: {
      if (!schema.properties) {
        return "Schema.Record(Schema.String, Schema.Unknown)";
      }

      const required = new Set(schema.required ?? []);

      const fields = Object.entries(schema.properties)
        .filter(([, prop]) => mode === "response" || !prop.readOnly)
        .map(([key, prop]) => {
          const value = render(prop, mode);

          const field = required.has(key)
            ? value
            : `Schema.optionalKey(${value})`;

          return `  ${JSON.stringify(key)}: ${field}`;
        });

      return `Schema.Struct({\n${fields.join(",\n")}\n})`;
    }

    default:
      return "Schema.Unknown";
  }
}

const ops: string[] = [];

for (const [route, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!OPERATIONS.some((operation) => operation === op.operationId)) {
      continue;
    }

    const pathParams = (op.parameters ?? [])
      .filter((p) => p.in === "path")
      .map((p) => p.name);

    const queryParams = (op.parameters ?? [])
      .filter((p) => p.in === "query")
      .map((p) => p.name);

    const requestSchema = op.requestBody?.content["application/json"]?.schema;

    const [status, response] =
      Object.entries(op.responses).find(([code]) => code.startsWith("2")) ?? [];

    const responseSchema = response?.content?.["application/json"]?.schema;
    ops.push(
      `export const ${op.operationId} = {\n` +
        `  method: ${JSON.stringify(method.toUpperCase())},\n` +
        `  path: ${JSON.stringify(route)},\n` +
        `  pathParams: ${JSON.stringify(pathParams)},\n` +
        `  queryParams: ${JSON.stringify(queryParams)},\n` +
        `  successStatus: ${status},\n` +
        `  request: ${requestSchema ? render(requestSchema, "request") : "undefined"},\n` +
        `  response: ${responseSchema ? render(responseSchema, "response") : "undefined"}\n` +
        "} as const"
    );
  }
}

const missing = OPERATIONS.filter(
  (id) => !ops.some((o) => o.startsWith(`export const ${id} `))
);

if (missing.length > 0) {
  throw new Error(`Operations not found in spec: ${missing.join(", ")}`);
}

const header = `// Generated by scripts/generate-cloud-api.ts from schemas/cloud-api.openapi.json
// (saleor-cloud-api ${source}). Do not edit by hand; run \`pnpm generate:api\`.
import { Schema } from "effect"
`;

const schemas = order.map(
  (id) =>
    `export const ${id} = ${emitted.get(id)}\nexport type ${id} = typeof ${id}.Type`
);

const generated = `${[header, ...schemas, ...ops].join("\n\n")}\n`;

if (process.argv.includes("--check")) {
  if (readFileSync(outPath, "utf8") !== generated) {
    throw new Error("Generated Cloud API is stale. Run pnpm generate:api.");
  }
} else {
  writeFileSync(outPath, generated);
}

console.log(
  `${process.argv.includes("--check") ? "Checked" : "Wrote"} ${order.length} schemas and ${ops.length} operations to ${path.relative(root, outPath)}`
);
