import {
  existsSync,
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
import { parse } from "yaml";
import {
  bindingName,
  initializeProject,
  projectAt,
  rememberEnvironment,
  saveBinding,
} from "./project.ts";

const roots: string[] = [];

const temp = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "saleor-workspace-"));
  roots.push(root);

  return root;
};

afterEach(() => {
  vi.unstubAllEnvs();

  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

it("creates a portable definition and private binding while preserving existing project content", async () => {
  vi.stubEnv("SALEOR_CONFIG_DIR", temp());
  const root = temp();
  writeFileSync(path.join(root, "AGENTS.md"), "Existing guidance\n");
  writeFileSync(path.join(root, "config.yml"), "channels: []\n");
  writeFileSync(
    path.join(root, "saleor.yml"),
    "name: shop\nstorefront:\n  path: packages/web\n"
  );

  const store = {
    kind: "local",
    name: "developer-one",
    ref: "local:developer-one",
    saleorVersion: "3.23.41",
  };

  await Effect.runPromise(initializeProject(root, "shop", store));
  await Effect.runPromise(initializeProject(root, "shop", store));
  const manifest = parse(readFileSync(path.join(root, "saleor.yml"), "utf8"));
  expect(manifest.environments).toEqual({
    local: { configure: "on-create", kind: "local", saleor: "3.23.41" },
  });
  expect(manifest.storefront.path).toBe("packages/web");
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).toBe(
    "Existing guidance\n"
  );
  expect(readFileSync(path.join(root, "config.yml"), "utf8")).toBe(
    "channels: []\n"
  );
  expect(existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
  expect(bindingName(root, "local")).toBe("developer-one");
  await Effect.runPromise(
    rememberEnvironment(root, "staging", "cloud:acme/key")
  );
  expect(Option.getOrThrow(projectAt(root)).environments).toContainEqual([
    "local",
    "local:developer-one",
  ]);
});

it("isolates two checkouts of the same project", () => {
  vi.stubEnv("SALEOR_CONFIG_DIR", temp());
  const first = temp();
  const second = temp();

  const manifest =
    "environments:\n  local:\n    kind: local\n    saleor: 3.23.41\n    configure: on-create\n";

  for (const root of [first, second]) {
    writeFileSync(path.join(root, "saleor.yml"), manifest);
  }

  expect(bindingName(first, "local")).not.toBe(bindingName(second, "local"));
  saveBinding(first, "local", "my-instance");
  expect(bindingName(first, "local")).toBe("my-instance");
  expect(bindingName(second, "local")).not.toBe("my-instance");
  expect(readFileSync(path.join(first, "saleor.yml"), "utf8")).toBe(manifest);
});

it("rejects invalid manifests rather than replacing them", async () => {
  const root = temp();
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "saleor.yml"), "environments: [broken]\n");
  await expect(
    Effect.runPromise(rememberEnvironment(root, "local", "local:test"))
  ).rejects.toBeDefined();
  expect(readFileSync(path.join(root, "saleor.yml"), "utf8")).toBe(
    "environments: [broken]\n"
  );
});
