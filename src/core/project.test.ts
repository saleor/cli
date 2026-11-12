import { Effect, Option } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { projectAt, rememberEnvironment } from "./project.ts";
import { bindingName, saveBinding } from "./bindings.ts";
import { initializeProject } from "./project-init.ts";

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
  } as const;

  await Effect.runPromise(initializeProject(root, "shop", store));
  await Effect.runPromise(initializeProject(root, "shop", store));
  const manifest = parse(readFileSync(path.join(root, "saleor.yml"), "utf-8"));
  expect(manifest.environments).toStrictEqual({
    local: { kind: "local", saleor: "3.23.41" },
  });
  expect(manifest.storefront.path).toBe("packages/web");
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf-8")).toBe(
    "Existing guidance\n"
  );
  expect(readFileSync(path.join(root, "config.yml"), "utf-8")).toBe(
    "channels: []\n"
  );
  expect(existsSync(path.join(root, "CLAUDE.md"))).toBe(true);
  expect(bindingName(root, "local")).toBe("developer-one");
  await Effect.runPromise(
    rememberEnvironment({
      root,
      wanted: "staging",
      ref: "cloud:acme/key",
    })
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
  expect(readFileSync(path.join(first, "saleor.yml"), "utf-8")).toBe(manifest);
});

it("falls back to the default local name when a binding file is damaged", () => {
  const config = temp();
  vi.stubEnv("SALEOR_CONFIG_DIR", config);
  const root = temp();
  writeFileSync(
    path.join(root, "saleor.yml"),
    "environments:\n  local:\n    kind: local\n    saleor: 3.23.41\n"
  );

  const fallback = bindingName(root, "local");
  saveBinding(root, "local", "my-instance");
  const [workspace] = readdirSync(path.join(config, "workspaces"));
  writeFileSync(
    path.join(config, "workspaces", String(workspace), "local.json"),
    '{"na'
  );
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  try {
    expect(Option.getOrThrow(projectAt(root)).environments).toStrictEqual([
      ["local", `local:${fallback}`],
    ]);
    expect(bindingName(root, "local")).toBe(fallback);
    expect(stderr).toHaveBeenCalledTimes(1);
  } finally {
    stderr.mockRestore();
  }
});

it("rejects invalid manifests rather than replacing them", async () => {
  const root = temp();
  mkdirSync(path.join(root, "nested"));
  writeFileSync(path.join(root, "saleor.yml"), "environments: [broken]\n");
  await expect(
    Effect.runPromise(
      rememberEnvironment({ root, wanted: "local", ref: "local:test" })
    )
  ).rejects.toBeDefined();
  expect(readFileSync(path.join(root, "saleor.yml"), "utf-8")).toBe(
    "environments: [broken]\n"
  );
});
