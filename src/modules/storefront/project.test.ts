import { Effect, Option } from "effect";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import {
  findProject,
  projectFolder,
  rememberEnvironment,
} from "../../core/project.ts";
import { projectChannel, storefrontFolder } from "./project.ts";

const temp = () =>
  mkdtempSync(path.join(os.tmpdir(), "saleor-storefront-test-"));

describe("projects", () => {
  it("remembers environments, finds the project from below, and knows its channel", async () => {
    const root = temp();

    expect(
      await Effect.runPromise(
        rememberEnvironment({
          root,
          wanted: "local",
          ref: "local:a",
          defaults: { name: "shop" },
        })
      )
    ).toStrictEqual({ added: true, name: "local" });
    expect(
      await Effect.runPromise(
        rememberEnvironment({ root, wanted: "local", ref: "local:a" })
      )
    ).toStrictEqual({
      added: false,
      name: "local",
    });
    expect(
      await Effect.runPromise(
        rememberEnvironment({ root, wanted: "local", ref: "local:b" })
      )
    ).toStrictEqual({
      added: true,
      name: "local-2",
    });

    writeFileSync(
      path.join(root, "config.yml"),
      stringify({ channels: [{ slug: "default-channel" }, { slug: "uk" }] })
    );

    const below = path.join(root, "storefront");
    mkdirSync(below);

    expect(
      Option.map(findProject(below), (project) => project.environments)
    ).toStrictEqual(
      Option.some([
        ["local", "local:a"],
        ["local-2", "local:b"],
      ])
    );
    expect(projectChannel(root)).toStrictEqual(Option.some("uk"));
    const previous = process.cwd();

    try {
      process.chdir(below);
      expect(projectFolder("another-name")).toBe(realpathSync(root));
      expect(storefrontFolder(Option.none(), ".")).toBe(realpathSync(below));
      expect(storefrontFolder(Option.some("custom"), ".")).toBe(
        path.join(realpathSync(below), "custom")
      );
    } finally {
      process.chdir(previous);
    }
  });
});
