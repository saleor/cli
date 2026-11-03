import { Effect, Option } from "effect";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { configFiles, recordComponent, componentFolder } from "./components.ts";
import { decodeManifest } from "./manifest.ts";
import { projectAt } from "./project.ts";

const roots: string[] = [];

const project = (manifest: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "saleor-components-"));
  roots.push(root);
  writeFileSync(path.join(root, "saleor.yml"), manifest);

  return root;
};

const manifestOf = (root: string) =>
  parse(readFileSync(path.join(root, "saleor.yml"), "utf-8"));

const record = async (
  dir: string,
  component: Parameters<typeof recordComponent>[1]
) => await Effect.runPromise(recordComponent(dir, component));

afterEach(() => {
  vi.restoreAllMocks();

  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

it("records a component by its folder, keeping a configuration a later record does not find", async () => {
  const root = project("version: 1\nname: shop\n");
  const dir = path.join(root, "apps", "web");
  mkdirSync(dir, { recursive: true });

  const first = await record(dir, {
    config: "content.yml",
    kind: "storefront",
  });

  expect(first).toStrictEqual(Option.some("web"));
  expect(manifestOf(root).components).toStrictEqual({
    web: { config: "content.yml", kind: "storefront", path: "apps/web" },
  });

  // Recorded again without finding its configuration: the recorded one stays.
  const again = await record(dir, { kind: "storefront" });

  expect(again).toStrictEqual(Option.some("web"));
  expect(manifestOf(root).components.web).toStrictEqual({
    config: "content.yml",
    kind: "storefront",
    path: "apps/web",
  });

  // The storefront is found where saleor.yml says, from anywhere in the project.
  vi.spyOn(process, "cwd").mockReturnValue(root);
  expect(componentFolder(Option.none(), "storefront", ".")).toBe(dir);
});

it("moves the old storefront key into components without losing its folder", async () => {
  const root = project("name: shop\nstorefront:\n  path: packages/web\n");

  expect(Option.getOrThrow(projectAt(root)).components).toStrictEqual([
    { kind: "storefront", name: "storefront", path: "packages/web" },
  ]);

  const dir = path.join(root, "storefront");
  mkdirSync(dir);

  // Another storefront: the old one keeps its name, the new one gets a free one.
  expect(await record(dir, { kind: "storefront" })).toStrictEqual(
    Option.some("storefront-2")
  );

  const manifest = manifestOf(root);

  expect(manifest.storefront).toBeUndefined();
  expect(manifest.components).toStrictEqual({
    storefront: { kind: "storefront", path: "packages/web" },
    "storefront-2": { kind: "storefront", path: "storefront" },
  });

  // A component in the folder named like it needs no path.
  const named = project("name: shop\n");
  mkdirSync(path.join(named, "storefront"));
  await record(path.join(named, "storefront"), { kind: "storefront" });

  expect(manifestOf(named).components).toStrictEqual({
    storefront: { kind: "storefront" },
  });
  expect(Option.getOrThrow(projectAt(named)).components).toStrictEqual([
    {
      config: undefined,
      kind: "storefront",
      name: "storefront",
      path: "storefront",
    },
  ]);
});

it("records nothing outside a project or outside its folder", async () => {
  const outside = mkdtempSync(path.join(os.tmpdir(), "saleor-no-project-"));
  roots.push(outside);

  expect(await record(outside, { kind: "storefront" })).toStrictEqual(
    Option.none()
  );

  const root = project("name: shop\n");

  expect(await record(root, { kind: "storefront" })).toStrictEqual(
    Option.none()
  );
  expect(manifestOf(root).components).toBeUndefined();
});

it("deploys the project's configuration first, then each component's", () => {
  const root = project(
    [
      "name: shop",
      "components:",
      "  web:",
      "    kind: storefront",
      "    path: apps/web",
      "    config: config/content.yml",
      "  payments:",
      "    kind: app",
      "",
    ].join("\n")
  );

  expect(configFiles(Option.getOrThrow(projectAt(root)))).toStrictEqual([
    { component: undefined, file: path.join(root, "config.yml") },
    {
      component: "web",
      file: path.join(root, "apps/web/config/content.yml"),
    },
  ]);
});

it("warns once about misspelled keys and refuses a newer manifest", () => {
  const stderr = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);

  const text = [
    "name: shop",
    "storefornt:",
    "  path: web",
    "environments:",
    "  local:",
    "    kind: local",
    "    saleor: '3.23.41'",
    "    configur: never",
    "",
  ].join("\n");

  const fields = decodeManifest("/shop/saleor.yml", text);
  decodeManifest("/shop/saleor.yml", text);

  expect(fields.name).toBe("shop");
  expect(stderr).toHaveBeenCalledTimes(1);
  expect(stderr).toHaveBeenCalledWith(
    "Ignoring unknown keys in /shop/saleor.yml: storefornt, environments.local.configur. Check the spelling.\n"
  );

  expect(() => decodeManifest("/shop/saleor.yml", "version: 2\n")).toThrow(
    "is version 2; this CLI reads version 1"
  );
});
