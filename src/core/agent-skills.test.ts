import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { createTarGzip } from "nanotar";
import { afterEach, expect, it, vi } from "vitest";
import { installSkills } from "./agent-skills.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }

  vi.unstubAllGlobals();
});

const setup = async (
  files = [{ data: "# Published skill", name: "SKILL.md" }],
  corrupt = false
) => {
  const directory = mkdtempSync(path.join(tmpdir(), "saleor-skills-"));
  dirs.push(directory);
  const archive = await createTarGzip(files);
  const digest = createHash("sha256").update(archive).digest("hex");

  const fetcher = vi.fn(async (url: string) =>
    url.endsWith("index.json")
      ? Response.json({
          skills: [
            {
              digest: `sha256:${corrupt ? "bad" : digest}`,
              name: "saleor-app",
              type: "archive",
              url: "/skill.tar.gz",
            },
          ],
        })
      : new Response(Buffer.from(archive))
  );

  vi.stubGlobal("fetch", fetcher);

  return {
    directory,
    fetcher,
    run: () =>
      Effect.runPromise(
        installSkills(directory, "https://example.com/index.json")
      ),
  };
};

it("installs a verified published archive and preserves existing skills on rerun", async () => {
  const { directory, run } = await setup();
  expect(await run()).toEqual({ installed: ["saleor-app"], skipped: [] });
  const skill = path.join(directory, "saleor-app", "SKILL.md");
  expect(readFileSync(skill, "utf8")).toBe("# Published skill");
  writeFileSync(skill, "my edits");
  expect(await run()).toEqual({ installed: [], skipped: ["saleor-app"] });
  expect(readFileSync(skill, "utf8")).toBe("my edits");
});

it("rejects a checksum mismatch before writing any skill", async () => {
  const { directory, run } = await setup(undefined, true);
  await expect(run()).rejects.toThrow("Checksum mismatch");
  expect(existsSync(path.join(directory, "saleor-app"))).toBe(false);
});

it("contains archive paths within the installed skill", async () => {
  const { directory, run } = await setup([
    { data: "bad", name: "../escaped" },
    { data: "skill", name: "SKILL.md" },
  ]);

  expect(await run()).toEqual({ installed: ["saleor-app"], skipped: [] });
  expect(existsSync(path.join(directory, "escaped"))).toBe(false);
});

it("preserves existing skill symlinks, including broken ones", async () => {
  const { directory, run, fetcher } = await setup();
  mkdirSync(path.join(directory, "other"));
  symlinkSync(
    path.join(directory, "missing"),
    path.join(directory, "saleor-app")
  );
  expect(await run()).toEqual({ installed: [], skipped: ["saleor-app"] });
  expect(fetcher).toHaveBeenCalledOnce();
});
