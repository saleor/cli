import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
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
import { down, list, planDown, planUp, up } from "./lifecycle.ts";
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
          return Effect.fail(fail("DOCKER_FAILED", "Injected Docker failure"));
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
  await runLocal(down("test", false));
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
    "DOCKER_FAILED"
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
  expect((await runLocal(list))[0]?.state).toBe("ready");
  ready = false;
  expect((await runLocal(list))[0]?.state).toBe("starting");
});

it("removes volumes, credentials and state when deleting data", async () => {
  await runLocal(up(options));
  await runLocal(down("test", true));
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

it("does nothing when the instance is already running and ready", async () => {
  await runLocal(up(options));
  const count = calls.length;
  const again = await runLocal(up(options));
  expect(again.created).toBe(false);
  expect(calls.slice(count).some((args) => args.includes("migrate"))).toBe(
    false
  );
  expect(calls.slice(count).some((args) => args.includes("up"))).toBe(false);
});

it("lets a run fix the options of an instance whose first setup failed", async () => {
  failing = "pull";
  await runLocal(up({ ...options, saleorVersion: "9.9.9" }).pipe(Effect.flip));
  expect((await runLocal(readConfig("test")))?.saleorVersion).toBe("9.9.9");
  failing = undefined;
  const fixed = await runLocal(up({ ...options, saleorVersion: "3.23.41" }));
  expect(fixed.saleorVersion).toBe("3.23.41");
});

it("names the differing option of an existing instance", async () => {
  await runLocal(up(options));

  const failure = await runLocal(
    up({ ...options, saleorVersion: "3.22.0" }).pipe(Effect.flip)
  );

  expect(failure.code).toBe("NAME_CONFLICT");
  expect(failure.message).toContain(
    'Saleor version is "3.23.41", not "3.22.0"'
  );
});

it("adds sample data to an existing instance", async () => {
  await runLocal(up(options));
  await runLocal(up({ ...options, sampleData: true }));
  expect((await runLocal(readConfig("test")))?.sampleData).toBe(true);
  expect(calls.at(-2)?.join(" ")).toContain("if True and not seeded");
});

it("names a published port that another program took", async () => {
  await runLocal(up(options));
  const config = await runLocal(readConfig("test"));
  const blocker = net.createServer();
  await new Promise<void>((resolve) =>
    blocker.listen(config?.dashboardPort, "127.0.0.1", resolve)
  );
  ready = false;

  try {
    const failure = await runLocal(up(options).pipe(Effect.flip));
    expect(failure.code).toBe("PORT_IN_USE");
    expect(failure.message).toContain(String(config?.dashboardPort));
    expect(failure.suggestion).toContain("--new-ports");

    ready = true;
    const moved = await runLocal(up({ ...options, newPorts: true }));
    expect(moved.dashboardUrl).not.toContain(String(config?.dashboardPort));
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

it("plans nothing for a missing instance, without Docker", async () => {
  expect(await runLocal(planDown("missing"))).toBeUndefined();
  expect(calls).toEqual([]);
});

it("plans up: create, finish, reuse or add sample data", async () => {
  expect(await runLocal(planUp(options))).toMatchObject({
    action: "create",
    state: "absent",
  });
  failing = "migrate";
  await runLocal(up(options).pipe(Effect.flip));
  failing = undefined;
  expect(await runLocal(planUp(options))).toMatchObject({
    action: "create",
    state: "incomplete",
  });
  await runLocal(up(options));
  expect(await runLocal(planUp(options))).toMatchObject({
    action: "reuse",
    state: "ready",
  });
  expect(
    await runLocal(planUp({ ...options, sampleData: true }))
  ).toMatchObject({ action: "update" });
  expect(
    (
      await runLocal(
        planUp({ ...options, saleorVersion: "3.22.0" }).pipe(Effect.flip)
      )
    ).code
  ).toBe("NAME_CONFLICT");
});

it("lists instances with their state", async () => {
  await runLocal(up(options));
  await runLocal(up({ ...options, name: "other" }));
  const instances = await runLocal(list);
  expect(instances.map((instance) => instance.name)).toEqual(["other", "test"]);
  expect(instances[0]?.state).toBe("ready");
});

it("prints the shared instance fields and login again for a running instance", async () => {
  await runLocal(up(options));
  const shown = await runLocal(up(options));
  expect(shown).toMatchObject({
    kind: "local",
    name: "test",
    ready: true,
    ref: "local:test",
    state: "ready",
  });
  expect(shown.admin.password?.length).toBeGreaterThan(20);
});

it("plans down without changing containers, files or credentials", async () => {
  await runLocal(up(options));

  const configBefore = readFileSync(
    path.join(instanceDir("test"), "instance.json"),
    "utf8"
  );

  const secretsBefore = new Map(secrets);
  calls = [];
  expect(await runLocal(planDown("test"))).toMatchObject({
    name: "test",
    state: "ready",
  });
  expect(
    calls.every((args) => !(args.includes("down") || args.includes("up")))
  ).toBe(true);
  expect(
    readFileSync(path.join(instanceDir("test"), "instance.json"), "utf8")
  ).toBe(configBefore);
  expect(secrets).toEqual(secretsBefore);
});
