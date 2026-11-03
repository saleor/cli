import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setEnv } from "../../core/env-file.ts";
import { fail } from "../../core/errors.ts";
import type { Store } from "../../core/store.ts";
import { findProject } from "../../core/project.ts";
import { deadlineIn, isPast, POLL } from "../../core/readiness.ts";
import { inspect, shown } from "./template.ts";

// An app running on this computer, installed on a local store in Docker. Inside the
// store's container `localhost` is the container itself, whatever Saleor's IP filter
// allows, so the store reaches this computer as `host.docker.internal` (Docker
// Desktop's name for it, mapped on Linux by the compose file). Two things follow, as
// Saleor's local app development guide describes:
//
// - the store fetches the manifest from host.docker.internal instead of localhost;
// - the manifest's own URLs must send the store to host.docker.internal too, and the
//   Dashboard, in the browser, to localhost. The Saleor app template takes both from
//   APP_API_BASE_URL and APP_IFRAME_BASE_URL in its .env, which the CLI sets for an
//   app the project lists.

export const DOCKER_HOST = "host.docker.internal";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

const parsed = (url: string) => {
  try {
    return Option.some(new URL(url));
  } catch {
    return Option.none<URL>();
  }
};

export const isLoopback = (url: string) =>
  Option.exists(parsed(url), (each) => LOOPBACK.has(each.hostname));

// The same address, as a store in Docker reaches it.
export const forDocker = (url: string) =>
  Option.match(parsed(url), {
    onNone: () => url,
    onSome: (each) => {
      each.hostname = DOCKER_HOST;

      return each.toString();
    },
  });

const Manifest = Schema.Struct({
  id: Schema.String,
  tokenTargetUrl: Schema.String,
});

// The manifest as this computer reads it.
const readManifest = (url: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const unreachable = () =>
      fail("USAGE_ERROR", `Nothing answers with a manifest at ${url}.`, {
        suggestion:
          "Start the app first (pnpm dev in its folder), then run this again.",
      });

    const response = yield* http
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson))
      .pipe(Effect.timeout(Duration.seconds(15)), Effect.mapError(unreachable));

    if (response.status !== 200) {
      return yield* unreachable();
    }

    return yield* response.json.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Manifest)),
      Effect.mapError(() =>
        fail("USAGE_ERROR", `${url} does not answer with an app manifest.`)
      )
    );
  });

// The project's app, found by the manifest id `app create` gave it.
const projectApp = (id: string) =>
  Option.flatMap(findProject(), (project) =>
    Option.fromUndefinedOr(
      project.components
        .filter((each) => each.kind === "app")
        .map((each) => path.resolve(project.root, each.path))
        .find((dir) => {
          const found = inspect(dir);

          return found.kind === "app" && found.id === id;
        })
    )
  );

export interface DockerManifest {
  // What the store is given to fetch.
  readonly manifestUrl: string;
  // The app's .env to point at Docker before installing, when it does not yet.
  readonly env: Option.Option<{
    readonly file: string;
    readonly values: Readonly<Record<string, string>>;
  }>;
}

// For a local store and an app on this computer: the manifest URL the store can
// fetch, and the .env change that makes the manifest's own URLs reachable. An app the
// project does not list, whose manifest still sends the store to localhost, is
// refused before anything is installed.
export const dockerManifest = (manifestUrl: string) =>
  Effect.gen(function* () {
    const manifest = yield* readManifest(manifestUrl);
    const storeUrl = forDocker(manifestUrl);

    if (!isLoopback(manifest.tokenTargetUrl)) {
      return {
        env: Option.none(),
        manifestUrl: storeUrl,
      } satisfies DockerManifest;
    }

    const { origin } = new URL(manifestUrl);

    const values = {
      APP_API_BASE_URL: forDocker(origin).replace(/\/$/, ""),
      APP_IFRAME_BASE_URL: origin,
    };

    const dir = projectApp(manifest.id);

    if (Option.isNone(dir)) {
      return yield* fail(
        "USAGE_ERROR",
        `The app's manifest sends the store to ${manifest.tokenTargetUrl}, which is the store's own container in Docker.`,
        {
          suggestion: `Have the manifest use ${values.APP_API_BASE_URL} for the store and ${values.APP_IFRAME_BASE_URL} for the Dashboard: in the Saleor app template, set ${Object.entries(
            values
          )
            .map(([key, value]) => `${key}=${value}`)
            .join(" and ")} in its .env and restart it.`,
        }
      );
    }

    return {
      env: Option.some({ file: path.join(dir.value, ".env"), values }),
      manifestUrl: storeUrl,
    } satisfies DockerManifest;
  });

// How long the running app gets to serve the new URLs.
const RELOAD_SECONDS = 20;

// Points the app's .env at Docker, then waits until the running app serves the new
// URLs: Next.js reloads .env by itself in development.
export const pointAtDocker = (
  { env }: DockerManifest,
  { manifestUrl, ref }: { readonly manifestUrl: string; readonly ref: string }
) =>
  Option.match(env, {
    onNone: () => Effect.void,
    onSome: ({ file, values }) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          writeFileSync(
            file,
            setEnv({
              note: "set by the Saleor CLI for a store in Docker",
              ref,
              text: existsSync(file) ? readFileSync(file, "utf-8") : "",
              values,
            })
          );
        });

        const deadline = deadlineIn(RELOAD_SECONDS);

        for (;;) {
          const manifest = yield* readManifest(manifestUrl);

          if (!isLoopback(manifest.tokenTargetUrl)) {
            return;
          }

          if (isPast(deadline)) {
            return yield* fail(
              "USAGE_ERROR",
              `The app still sends the store to ${manifest.tokenTargetUrl} after ${shown(file)} changed.`,
              {
                suggestion:
                  "Restart the app (pnpm dev) so it reads .env, then run this again.",
              }
            );
          }

          yield* Effect.sleep(POLL);
        }
      }),
  });

// The manifest URL to give a store, what to do before installing so the app answers
// it, and how to show that. Only a local store and an app on this computer need any.
export const reachableManifest = (instance: Store, given: string) =>
  Effect.gen(function* () {
    if (instance.kind !== "local" || !isLoopback(given)) {
      return {
        env: null,
        manifestUrl: given,
        prepare: Effect.void,
        summary: [],
      };
    }

    const docker = yield* dockerManifest(given);

    return {
      env: Option.getOrNull(docker.env),
      manifestUrl: docker.manifestUrl,
      prepare: pointAtDocker(docker, { manifestUrl: given, ref: instance.ref }),
      summary: Option.match(docker.env, {
        onNone: () => [],
        onSome: ({ file, values }) => [
          [
            "App settings",
            `${shown(file)}: ${Object.entries(values)
              .map(([key, value]) => `${key}=${value}`)
              .join(", ")}`,
          ] as const,
        ],
      }),
    };
  });
