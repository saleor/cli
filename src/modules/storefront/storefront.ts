import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { TargetRef } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import {
  connectedRef,
  declares,
  parseEnv,
  setEnv,
} from "../../core/env-file.ts";
import { fail } from "../../core/errors.ts";
import type { Instance, InstanceSource } from "../../core/instance.ts";
import { command } from "../../core/invocation.ts";
import { columns } from "../../core/output.ts";
import {
  directoryState,
  downloadTemplate,
  initRepository,
  installDependencies,
  template,
} from "../../core/scaffold.ts";

// A storefront is the saleor/storefront template, downloaded as it is on `main`, with
// its `.env` pointing at one store: the store's GraphQL API and a channel. Nothing else
// about it is recorded: the `.env` header says which store it is connected to.

export const TEMPLATE = template(
  "saleor/storefront",
  "main",
  process.env.SALEOR_STOREFRONT_TEMPLATE_URL
);

export const API_URL = "NEXT_PUBLIC_SALEOR_API_URL";
export const CHANNEL = "NEXT_PUBLIC_DEFAULT_CHANNEL";
export const DEFAULT_CHANNEL = "default-channel";

const ENV_NOTE = "set by the Saleor CLI";

// What a directory holds: nothing, a storefront (connected to a store or not), or
// something else, which is never written into.
export type Found =
  | { readonly kind: "absent" }
  | { readonly kind: "other" }
  | {
      readonly channel: string | undefined;
      readonly kind: "storefront";
      readonly graphqlUrl: string | undefined;
      readonly ref: string | undefined;
    };

const read = (file: string) =>
  existsSync(file) ? readFileSync(file, "utf8") : undefined;

export const inspect = (dir: string) =>
  Effect.sync((): Found => {
    if (directoryState(dir) !== "used") {
      return { kind: "absent" };
    }

    const env = read(path.join(dir, ".env"));
    const example = read(path.join(dir, ".env.example"));

    const isStorefront =
      existsSync(path.join(dir, "package.json")) &&
      [env, example].some(
        (text) => text !== undefined && declares(text, API_URL)
      );

    if (!isStorefront) {
      return { kind: "other" };
    }

    return {
      channel: env === undefined ? undefined : parseEnv(env).get(CHANNEL),
      graphqlUrl: parseEnv(env ?? example ?? "").get(API_URL),
      kind: "storefront",
      ref: env === undefined ? undefined : connectedRef(env),
    };
  });

// How a directory is named in output: relative to where the command ran.
export const shown = (dir: string) => path.relative(process.cwd(), dir) || ".";

export const storefrontTarget = (dir: string): TargetRef => ({
  id: null,
  name: shown(dir),
  scope: {},
  type: "storefront",
});

export const notStorefront = (dir: string) =>
  fail(
    "NAME_CONFLICT",
    `${shown(dir)} is not empty and is not a Saleor storefront.`,
    {
      suggestion:
        "Choose an empty or new directory with --dir, or move its files away.",
    }
  );

export const connectedElsewhere = (dir: string, ref: string, wanted: string) =>
  fail(
    "NAME_CONFLICT",
    `The storefront in ${shown(dir)} is connected to ${ref}, not ${wanted}.`,
    {
      details: { connected: ref, requested: wanted },
      suggestion: `To switch this storefront to ${wanted}, run: ${command("storefront", "env", "--dir", shown(dir), "--instance", wanted)}`,
    }
  );

// ── Applying ─────────────────────────────────────────────────────────────

const ChannelAnswer = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        channel: Schema.optionalKey(
          Schema.NullOr(Schema.Struct({ slug: Schema.String }))
        ),
      })
    )
  ),
});

// Asks the store whether the channel exists. Unknown when it does not answer or does
// not say (a store that only shows channels to staff).
const channelExists = (graphqlUrl: string, slug: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const request = HttpClientRequest.post(graphqlUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        query: "query ($slug: String!) { channel(slug: $slug) { slug } }",
        variables: { slug },
      })
    );

    const answer = yield* http.execute(request).pipe(
      Effect.flatMap((response) => response.json),
      Effect.flatMap(Schema.decodeUnknownEffect(ChannelAnswer)),
      Effect.timeout(Duration.seconds(10)),
      Effect.option
    );

    return Option.flatMap(answer, (body) =>
      body.data?.channel === undefined
        ? Option.none()
        : Option.some(body.data.channel !== null)
    );
  });

const STARTED = new Set(["ready", "running"]);

const storeWarnings = (
  store: Instance,
  source: InstanceSource<never> | undefined,
  channel: string
) =>
  Effect.gen(function* () {
    if (!STARTED.has(store.state)) {
      const id = store.ref.slice(store.ref.indexOf(":") + 1);
      const start = source?.startCommand?.(id);

      return [
        `${store.ref} is ${store.state}, so the channel was not checked. The storefront shows no products until the store runs.${start === undefined ? "" : ` Start it with: ${start}`}`,
      ];
    }

    const exists = yield* channelExists(store.graphqlUrl, channel);

    return Option.match(exists, {
      onNone: () => [
        `Could not check that channel "${channel}" exists in ${store.ref}. If it does not, pass another one with --channel.`,
      ],
      onSome: (found) =>
        found
          ? []
          : [
              `${store.ref} has no channel "${channel}". Find the channel slugs in its dashboard (Configuration › Channels), then set NEXT_PUBLIC_DEFAULT_CHANNEL in the storefront's .env`,
            ],
    });
  });

// Points the storefront's `.env` at the store: the file itself if there is one, else a
// copy of the template's `.env.example`, so its documented defaults stay.
const writeEnv = (dir: string, store: Instance, channel: string) =>
  Effect.try({
    catch: (error) =>
      fail(
        "LOCAL_STATE_ERROR",
        `Could not write ${path.join(shown(dir), ".env")}: ${error instanceof Error ? error.message : String(error)}`
      ),
    try: () => {
      const file = path.join(dir, ".env");
      const current = read(file);
      const example = read(path.join(dir, ".env.example"));
      const values = { [API_URL]: store.graphqlUrl, [CHANNEL]: channel };

      // The template follows `main`; say so when it stops declaring a key the CLI sets.
      const undeclared =
        current === undefined && example !== undefined
          ? Object.keys(values).filter((key) => !declares(example, key))
          : [];

      writeFileSync(
        file,
        setEnv(current ?? example ?? "", values, store.ref, ENV_NOTE)
      );

      return {
        values,
        warnings: undeclared.map(
          (key) =>
            `The template's .env.example no longer mentions ${key}; it was set anyway, but the template may have changed how it is configured.`
        ),
      };
    },
  });

export interface Finish {
  readonly channel: string;
  readonly created: boolean;
  readonly dir: string;
  readonly install: boolean;
  // Where to make a repository, if the storefront was just downloaded.
  readonly repository: string | undefined;
  readonly source: InstanceSource<never> | undefined;
  readonly store: Instance;
}

// Connects a downloaded storefront to its store, then makes it a repository and
// installs its packages when asked. Everything after the `.env` only warns.
export const finish = (spec: Finish) =>
  Effect.gen(function* () {
    const env = yield* writeEnv(spec.dir, spec.store, spec.channel);

    const repository =
      spec.repository === undefined
        ? undefined
        : yield* initRepository(
            spec.repository,
            `Start from ${TEMPLATE.repository} (${TEMPLATE.ref})`
          );

    const installed = spec.install
      ? yield* installDependencies(spec.dir)
      : undefined;

    const warnings = [
      ...env.warnings,
      ...(yield* storeWarnings(spec.store, spec.source, spec.channel)),
      ...[repository?.warning, installed?.warning].filter(
        (warning): warning is string => warning !== undefined
      ),
    ];

    const dependenciesInstalled =
      installed?.installed ?? existsSync(path.join(spec.dir, "node_modules"));

    const cd = shown(spec.dir);

    const next = [
      ...(cd === "." ? [] : [`cd ${cd}`]),
      ...(dependenciesInstalled ? [] : ["pnpm install"]),
      "pnpm dev",
    ];

    const data = {
      channel: spec.channel,
      created: spec.created,
      env: env.values,
      installed: dependenciesInstalled,
      next,
      path: spec.dir,
      repository: repository?.repository ?? null,
      store: {
        graphqlUrl: spec.store.graphqlUrl,
        kind: spec.store.kind,
        name: spec.store.name,
        ref: spec.store.ref,
        state: spec.store.state,
      },
      template: { ref: TEMPLATE.ref, repository: TEMPLATE.repository },
      warnings,
    };

    const text = [
      columns([
        ["  Directory:", cd],
        ["  Store:", `${spec.store.ref} (${spec.store.graphqlUrl})`],
        ["  Channel:", spec.channel],
      ]),
      ...warnings.map((warning) => `  Warning: ${warning}`),
      "",
      "Run it:",
      ...next.map((line) => `  ${line}`),
      "",
      "To deploy it, set these environment variables where it is hosted:",
      ...Object.entries(env.values).map(([key, value]) => `  ${key}=${value}`),
    ];

    return result(data, text.join("\n"));
  });

// Downloads the template into `dir`, then finishes it.
export const create = (spec: Finish) =>
  Effect.andThen(downloadTemplate(TEMPLATE, spec.dir), finish(spec));
