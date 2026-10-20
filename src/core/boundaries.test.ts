import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);

    return entry.isDirectory() ? files(file) : [file];
  });

const IMPORT = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/g;

it("keeps core independent of providers and modules independent of siblings", () => {
  const root = path.resolve("src");

  for (const file of [
    ...files(path.join(root, "core")),
    ...files(path.join(root, "modules")),
  ].filter((entry) => entry.endsWith(".ts"))) {
    const owner = path.relative(root, file).split(path.sep);

    for (const match of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const [, specifier] = match;

      if (!specifier?.startsWith(".")) {
        continue;
      }

      const destination = path
        .relative(root, path.resolve(path.dirname(file), specifier))
        .split(path.sep);

      if (owner[0] === "core") {
        expect(destination[0], file).not.toBe("modules");
      }

      if (owner[0] === "modules" && destination[0] === "modules") {
        expect(destination[1], file).toBe(owner[1]);
      }
    }
  }
});
