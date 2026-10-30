import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ConfiguratorFailure,
  DiffChange,
  DiffResult,
  DiffSummary,
  SaleorConfig,
} from "@saleor/configurator";
import { Effect } from "effect";
import { fail } from "../../core/errors.ts";
import { command } from "../../core/invocation.ts";
import { isDocument, type Json } from "./document.ts";

// Configurator's public library, run in-process and loaded on first use. Commands
// that do not touch configuration pay nothing for it at startup.
const engineModule = Effect.promise(() => import("@saleor/configurator"));

export const DEFAULT_CONFIG = "config.yml";

export const shown = (file: string) => path.relative(process.cwd(), file);

// The engine's own suggestions name the standalone tool's flags (--token), so each
// code gets the CLI's suggestion instead.
const toFailure = (error: ConfiguratorFailure) => {
  const details =
    error.issues.length > 0 ? { issues: error.issues } : undefined;

  switch (error.code) {
    case "CONFIG_INVALID":
      return fail(
        "CONFIG_INVALID",
        [
          error.message,
          ...error.issues.map((issue) => `  ${issue.path}: ${issue.message}`),
        ].join("\n"),
        {
          details,
          suggestion: `Fix the file, then check it with: ${command("config", "validate")}`,
        }
      );
    case "STORE_AUTH_INVALID":
      return fail("STORE_AUTH_INVALID", error.message, {
        suggestion: "Set SALEOR_TOKEN to a token with those permissions.",
      });
    case "NETWORK_ERROR":
      return fail("NETWORK_ERROR", error.message, {
        suggestion:
          "Check that the store is running, then run the command again.",
      });
    case "DEPLOY_PARTIAL":
      return fail("DEPLOY_PARTIAL", error.message, { details });
    default:
      return fail("STORE_ERROR", error.message, { details });
  }
};

// Runs one engine call; whatever it throws becomes a failure with a stable code.
const attempt = <A>(
  run: (engine: typeof import("@saleor/configurator")) => Promise<A>
) =>
  Effect.flatMap(engineModule, (engine) =>
    Effect.tryPromise({
      catch: (error) => toFailure(engine.classifyError(error)),
      try: () => run(engine),
    })
  );

// The configuration file, which must exist for everything but pull.
export const existingConfig = (file: string) =>
  existsSync(file)
    ? Effect.succeed(file)
    : fail("CONFIG_INVALID", `No configuration file at ${shown(file)}.`, {
        suggestion: `Write one from a store with: ${command("config", "pull")}`,
      });

export const validateFile = (file: string) =>
  attempt((engine) => engine.validate(file));

export const serialize = (config: SaleorConfig) =>
  Effect.map(engineModule, (engine) => engine.serialize(config));

export interface Store {
  readonly token: string;
  readonly url: string;
}

export const pull = (store: Store) =>
  attempt((engine) => engine.createConfigurator(store).introspect());

// The engine's comparators report differences that are not changes: a field the file
// leaves out (so it has no opinion on it), a value Saleor fills in itself such as
// `publishedAt`, the same attributes in another key order. A file that `pull` did not
// write would never converge. Only differences where the file asks for something the
// store does not have are kept.
const sameJson = (a: Json | undefined, b: Json | undefined): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => sameJson(item, b[i]))
    );
  }

  if (!(isDocument(a) && isDocument(b))) {
    return a === b;
  }

  const keys = Object.keys(a);

  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => sameJson(a[key], b[key]))
  );
};

// Everything the file asks for is already there; extra fields in the store are fine.
const covers = (current: Json | undefined, desired: Json): boolean =>
  isDocument(desired) && isDocument(current)
    ? Object.entries(desired).every(([key, value]) =>
        covers(current[key], value)
      )
    : sameJson(current, desired);

const real = (each: DiffChange) =>
  each.desiredValue !== undefined &&
  !covers(each.currentValue, each.desiredValue);

export const meaningful = (summary: DiffSummary): DiffSummary => {
  const results = summary.results.flatMap((result) => {
    if (result.operation !== "UPDATE" || result.changes === undefined) {
      return [result];
    }

    const changes = result.changes.filter(real);

    return changes.length === 0 ? [] : [{ ...result, changes }];
  });

  const count = (operation: DiffResult["operation"]) =>
    results.filter((result) => result.operation === operation).length;

  return {
    creates: count("CREATE"),
    deletes: count("DELETE"),
    results,
    totalChanges: results.length,
    updates: count("UPDATE"),
  };
};

export const diff = (store: Store, file: string) =>
  Effect.map(
    attempt((engine) => engine.createConfigurator(store).diff(file)),
    meaningful
  );

export const deploy = (store: Store, file: string, summary: DiffSummary) =>
  attempt((engine) => engine.createConfigurator(store).deploy(file, summary));

export const supportedSaleor = Effect.map(
  engineModule,
  (engine) => engine.SUPPORTED_SALEOR
);

const OPERATIONS = {
  CREATE: "create",
  DELETE: "delete",
  UPDATE: "update",
} as const;

// A change as commands show it: no entity payloads, which can be large.
export const change = (result: DiffResult) => ({
  entity: result.entityType,
  fields: (result.changes ?? []).map((each) => each.field),
  name: result.entityName,
  operation: OPERATIONS[result.operation],
});

export type Change = ReturnType<typeof change>;

// How many entries each section of a configuration has, for summaries.
export const sections = (config: SaleorConfig) =>
  Object.fromEntries(
    Object.entries(config).map(([section, value]) => [
      section,
      Array.isArray(value) ? value.length : 1,
    ])
  );
