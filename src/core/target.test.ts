import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Option } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import {
  collectTargetProviders,
  readTargetRef,
  resolveTarget,
  type TargetProvider,
  writeTargetRef,
} from "./target.ts";

const dirs: string[] = [];

const folder = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "saleor-target-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, ".saleor"));

  return dir;
};

afterEach(() => {
  vi.unstubAllEnvs();

  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

it("reads legacy Cloud links and writes a v2 target without losing other sections", async () => {
  const dir = folder();
  const cloud = { environment: "dev", organization: "acme", project: "shop" };
  writeFileSync(
    path.join(dir, ".saleor/link.json"),
    JSON.stringify({ cloud, other: { keep: true } })
  );
  expect(await Effect.runPromise(readTargetRef(dir))).toBe(
    "cloud:acme/shop/dev"
  );
  await Effect.runPromise(writeTargetRef("local:demo", dir));
  expect(await Effect.runPromise(readTargetRef(dir))).toBe("local:demo");
  expect(
    JSON.parse(readFileSync(path.join(dir, ".saleor/link.json"), "utf8"))
  ).toEqual({ cloud, other: { keep: true }, target: "local:demo", version: 2 });
});

it("rejects unknown providers and duplicate ownership", async () => {
  const provider: TargetProvider = {
    kind: "local",
    resolve: () => Effect.die("must not resolve"),
  };

  expect(() =>
    collectTargetProviders([{ target: provider }, { target: provider }])
  ).toThrow("Duplicate target provider");

  const outcome = await Effect.runPromise(
    resolveTarget(new Map(), Option.some("missing:shop")).pipe(Effect.flip)
  );

  expect(outcome.code).toBe("USAGE_ERROR");
});

it("resolves an explicit target before the environment and directory link", async () => {
  const dir = folder();
  await Effect.runPromise(writeTargetRef("local:linked", dir));

  const provider: TargetProvider = {
    kind: "local",
    resolve: (ref) =>
      Effect.succeed({
        credentials: Effect.die("credentials must stay lazy"),
        dashboardUrl: null,
        graphqlUrl: "http://localhost/graphql/",
        kind: "local",
        name: ref,
        ref,
        saleorVersion: null,
      }),
  };

  const providers = collectTargetProviders([{ target: provider }]);
  vi.stubEnv("SALEOR_TARGET", "local:environment");
  expect(
    (
      await Effect.runPromise(
        resolveTarget(providers, Option.some("local:explicit"), dir)
      )
    ).ref
  ).toBe("local:explicit");
  expect(
    (await Effect.runPromise(resolveTarget(providers, Option.none(), dir))).ref
  ).toBe("local:environment");
  vi.stubEnv("SALEOR_TARGET", undefined);
  expect(
    (await Effect.runPromise(resolveTarget(providers, Option.none(), dir))).ref
  ).toBe("local:linked");
});
