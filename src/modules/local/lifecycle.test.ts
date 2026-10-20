import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer, Option } from "effect";
import type { GlobalFlag } from "effect/cli";
import { HttpClient, HttpClientResponse } from "effect/http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fail } from "../../core/errors.ts";
import { OutputFlag } from "../../core/output.ts";
import { SecretStore } from "../../core/secret-store.ts";
import { Docker } from "./docker.ts";
import { down, status, up } from "./lifecycle.ts";
import { instanceDir, readConfig } from "./state.ts";

let dir: string;
let calls: string[][];
let secrets: Map<string, string>;
let ready: boolean;
let failing: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "saleor-local-"));
  vi.stubEnv("SALEOR_CONFIG_DIR", dir);
  calls = [];
  secrets = new Map();
  ready = true;
  failing = undefined;
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { force: true, recursive: true });
});

const services = () =>
  Layer.mergeAll(
    Layer.succeed(Docker, {
      run: (args) => {
        calls.push([...args]);

        if (failing && args.includes(failing)) {
          return Effect.fail(fail("TASK_FAILED", "Injected Docker failure"));
        }

        return Effect.succeed(
          args.includes("ps") ? '{"Service":"api","State":"running"}\n' : ""
        );
      },
    }),
    Layer.succeed(SecretStore, {
      backend: "file",
      get: (key) => Effect.sync(() => secrets.get(key)),
      remove: (key) =>
        Effect.sync(() => {
          secrets.delete(key);
        }),
      set: (key, value) =>
        Effect.sync(() => {
          secrets.set(key, value);
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(
              ready
                ? { data: { shop: { name: "Local shop" } } }
                : { errors: [{ message: "Starting" }] }
            )
          )
        )
      )
    )
  );

const runLocal = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | Docker
    | SecretStore
    | HttpClient.HttpClient
    | GlobalFlag.Setting.Identifier<"output">
  >
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(OutputFlag, Option.some("json")),
      Effect.provide(services())
    )
  );

const options = {
  name: "test",
  saleorVersion: undefined,
  sampleData: false,
  timeout: 0,
};

it("reuses ports, secrets and volumes across up/down/up", async () => {
  const first = await runLocal(up(options));
  expect(first.created).toBe(true);
  expect(first.ready).toBe(true);
  expect(first.admin.password.length).toBeGreaterThan(20);
  expect(
    readFileSync(path.join(instanceDir("test"), "compose.yaml"), "utf8")
  ).not.toContain(first.admin.password);
  await runLocal(down("test", false, false));
  expect(calls.at(-1)).not.toContain("--volumes");
  const second = await runLocal(up(options));
  expect(second.created).toBe(false);
  expect(second.graphqlUrl).toBe(first.graphqlUrl);
  expect(second.admin).toEqual(first.admin);
  expect(calls.filter((args) => args.includes("pull"))).toHaveLength(1);
});

it("recovers setup after a migration failure without changing credentials", async () => {
  failing = "migrate";
  expect((await runLocal(up(options).pipe(Effect.flip))).code).toBe(
    "TASK_FAILED"
  );
  const initialSecrets = new Map(secrets);
  expect((await runLocal(readConfig("test")))?.initialized).toBe(false);
  failing = undefined;
  expect((await runLocal(up(options))).ready).toBe(true);
  expect(secrets).toEqual(initialSecrets);
  expect(existsSync(path.join(dir, "local", ".test.lock"))).toBe(false);
});

it("returns NOT_READY after launch and can be retried", async () => {
  ready = false;
  const failure = await runLocal(up(options).pipe(Effect.flip));
  expect(failure.code).toBe("NOT_READY");
  expect(failure.suggestion).toContain("Docker");
  expect((await runLocal(readConfig("test")))?.initialized).toBe(true);
  ready = true;
  expect((await runLocal(up(options))).ready).toBe(true);
});

it("checks API readiness separately from container state", async () => {
  await runLocal(up(options));
  expect((await runLocal(status("test"))).state).toBe("ready");
  ready = false;
  expect((await runLocal(status("test"))).state).toBe("starting");
});

it("requires confirmation before volume deletion, then removes credentials and state", async () => {
  await runLocal(up(options));
  const count = calls.length;
  const failure = await runLocal(down("test", true, false).pipe(Effect.flip));
  expect(failure.code).toBe("CONFIRMATION_REQUIRED");
  expect(calls).toHaveLength(count);
  await runLocal(down("test", true, true));
  expect(calls.at(-1)).toContain("--volumes");
  expect(secrets.size).toBe(0);
  expect(existsSync(instanceDir("test"))).toBe(false);
});

it("rejects unsafe names before invoking Docker", async () => {
  expect(
    (await runLocal(up({ ...options, name: "../../other" }).pipe(Effect.flip)))
      .code
  ).toBe("USAGE_ERROR");
  expect(calls).toEqual([]);
});
