import { Context, Effect, Schema } from "effect";
import { parseTarGzip } from "nanotar";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { type CliFailure, fail } from "./errors.ts";

export const SKILLS_INDEX =
  "https://docs.saleor.io/.well-known/agent-skills/index.json";

const SkillIndex = Schema.Struct({
  skills: Schema.Array(
    Schema.Struct({
      digest: Schema.String,
      name: Schema.String,
      type: Schema.Literal("archive"),
      url: Schema.String,
    })
  ),
});

const download = async (url: string) => {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Download returned HTTP ${response.status}.`);
  }

  return response;
};

const exists = (target: string) => {
  try {
    lstatSync(target);

    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Validate every archive entry before writing. The parser normalizes paths and we
// reject links and any remaining traversal;
// existing skills (including user symlinks) are preserved rather than overwritten.
const unpackSkill = async (archive: Uint8Array, directory: string) => {
  const entries = await parseTarGzip(archive);

  for (const entry of entries) {
    const segments = entry.name.split("/");

    if (
      path.isAbsolute(entry.name) ||
      entry.name.includes("\\") ||
      segments.includes("..") ||
      (entry.type !== "file" && entry.type !== "directory")
    ) {
      throw new Error(`Unsafe skill archive entry: ${entry.name}`);
    }
  }

  if (
    !entries.some((entry) => entry.name === "SKILL.md" && entry.type === "file")
  ) {
    throw new Error("Skill archive has no SKILL.md.");
  }

  for (const entry of entries) {
    const destination = path.join(directory, entry.name);

    if (entry.type === "directory") {
      mkdirSync(destination, { recursive: true });
    } else {
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, entry.data ?? new Uint8Array());
    }
  }
};

export interface SkillsInstalled {
  readonly installed: readonly string[];
  readonly skipped: readonly string[];
}

export const installSkills = (directory: string, indexUrl = SKILLS_INDEX) =>
  Effect.tryPromise({
    catch: (error) =>
      fail("UNAVAILABLE", `Could not install Saleor skills: ${String(error)}`, {
        suggestion:
          "Existing skills were preserved. Run saleor onboard to retry.",
      }),
    try: async (): Promise<SkillsInstalled> => {
      const response = await download(indexUrl);
      const index = Schema.decodeUnknownSync(SkillIndex)(await response.json());
      const installed: string[] = [];
      const skipped: string[] = [];

      for (const skill of index.skills) {
        if (!safeName.test(skill.name)) {
          throw new Error("Invalid skill name in discovery manifest.");
        }

        const url = new URL(skill.url, indexUrl);

        if (url.origin !== new URL(indexUrl).origin) {
          throw new Error(
            "Skill archive must come from the discovery manifest's origin."
          );
        }

        const target = path.join(directory, skill.name);

        // lstat below also recognizes broken symlinks as existing user content.
        if (exists(target)) {
          skipped.push(skill.name);
          continue;
        }

        // oxlint-disable-next-line no-await-in-loop -- Finish each skill before starting the next so retries preserve completed installations.
        const archiveResponse = await download(url.href);
        // oxlint-disable-next-line no-await-in-loop -- Each archive is checked and installed before downloading the next.
        const archive = new Uint8Array(await archiveResponse.arrayBuffer());

        const digest = `sha256:${createHash("sha256").update(archive).digest("hex")}`;

        if (digest !== skill.digest) {
          throw new Error(`Checksum mismatch for ${skill.name}.`);
        }

        mkdirSync(directory, { recursive: true });
        const staging = mkdtempSync(path.join(directory, ".saleor-skill-"));

        try {
          // oxlint-disable-next-line no-await-in-loop -- Complete this staging directory before moving to the next skill.
          await unpackSkill(archive, staging);
          renameSync(staging, target);
          installed.push(skill.name);
        } finally {
          rmSync(staging, { force: true, recursive: true });
        }
      }

      return { installed, skipped };
    },
  });

export const SkillInstaller = Context.Reference<{
  readonly install: (
    directory: string
  ) => Effect.Effect<SkillsInstalled, CliFailure>;
}>("saleor/SkillInstaller", {
  defaultValue: () => ({ install: installSkills }),
});
