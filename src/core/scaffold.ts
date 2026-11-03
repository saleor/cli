import { Duration, Effect, Option } from "effect";
import { HttpClient } from "effect/http";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { type ReadEntry, Unpack } from "tar";
import { fail } from "./errors.ts";
import { shown, withProgress } from "./output.ts";

// Starting a project from a template repository (the storefront today, the app
// template next): download it as a fresh copy without its history, make it a
// repository of its own unless it already sits in one, and install its packages.

export interface Template {
  // The branch followed: templates are taken as they are now, not pinned.
  readonly ref: string;
  // owner/name on GitHub.
  readonly repository: string;
  readonly url: string;
}

export const template = (
  repository: string,
  ref: string,
  override: string | undefined
): Template => ({
  ref,
  repository,
  url:
    override ??
    `https://codeload.github.com/${repository}/tar.gz/refs/heads/${ref}`,
});

// Files an operating system leaves in any folder; a folder with only these is empty.
const LITTER = new Set([".DS_Store", "Thumbs.db"]);

export type DirectoryState = "absent" | "empty" | "used";

export const directoryState = (dir: string): DirectoryState => {
  if (!existsSync(dir)) {
    return "absent";
  }

  return readdirSync(dir).every((entry) => LITTER.has(entry))
    ? "empty"
    : "used";
};

const templateFailure = (from: Template, reason: string) =>
  fail(
    "TEMPLATE_FAILED",
    `Could not download the ${from.repository} template: ${reason}`,
    {
      details: { url: from.url },
      suggestion:
        "Check your connection to GitHub, then run the same command again.",
    }
  );

// GitHub archives say which commit they are in a global header ("comment=<sha>").
const COMMIT = /^[0-9a-f]{40}$/;

// Writes the archive's files into `dir`, dropping the top folder GitHub wraps them in.
// `tar` refuses entries that would land outside `dir`, absolute or through a link.
// Returns the commit the archive was made from, when it says.
const unpack = async (archive: ArrayBuffer, dir: string) =>
  await new Promise<string | undefined>((resolve, reject) => {
    const extractor = new Unpack({ cwd: dir, strict: true, strip: 1 });
    let commit: string | undefined;

    extractor.on("entry", (entry: ReadEntry) => {
      const comment = entry.globalExtended?.comment;
      commit ??=
        comment !== undefined && COMMIT.test(comment) ? comment : undefined;
    });
    extractor.on("error", reject);
    extractor.on("close", () => {
      resolve(commit);
    });
    extractor.end(Buffer.from(archive));
  });

export interface Downloaded {
  // The commit downloaded; none when the archive does not say.
  readonly commit: string | undefined;
}

// Where a download came from, in words: <owner>/<repo>@<commit>, or the branch when
// the archive does not say which commit it is.
export const templateSource = (from: Template, downloaded: Downloaded) =>
  downloaded.commit === undefined
    ? `${from.repository} (${from.ref})`
    : `${from.repository}@${downloaded.commit}`;

// Downloads the template into `dir`, which must not exist or be empty. The files are
// unpacked next to it first and moved in at once, so `dir` is never half-written.
export const downloadTemplate = (from: Template, dir: string) =>
  withProgress(
    `Downloading the ${from.repository} template (${from.ref})…`,
    "Template downloaded.",
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;

      const response = yield* http.get(from.url).pipe(
        Effect.timeout(Duration.minutes(2)),
        Effect.mapError((error) => templateFailure(from, String(error)))
      );

      if (response.status !== 200) {
        return yield* templateFailure(
          from,
          `the server answered ${response.status}.`
        );
      }

      const body = yield* response.arrayBuffer.pipe(
        Effect.mapError((error) => templateFailure(from, String(error)))
      );

      const staging = `${dir}.download-${process.pid}`;

      return yield* Effect.tryPromise({
        catch: (error) =>
          templateFailure(
            from,
            error instanceof Error ? error.message : String(error)
          ),
        try: async (): Promise<Downloaded> => {
          rmSync(staging, { force: true, recursive: true });
          mkdirSync(staging, { recursive: true });
          const commit = await unpack(body, staging);
          rmSync(dir, { force: true, recursive: true });
          renameSync(staging, dir);

          return { commit };
        },
      }).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            rmSync(staging, { force: true, recursive: true });
          })
        )
      );
    })
  );

// ── Processes ────────────────────────────────────────────────────────────

interface Ran {
  readonly code: number | null;
  readonly output: string;
}

// Runs a program in `cwd`; None when it is not installed.
const exec = (program: string, args: readonly string[], cwd: string) =>
  Effect.callback<Option.Option<Ran>>((resume) => {
    const child = spawn(program, [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => {
      resume(Effect.succeedNone);
    });
    child.on("close", (code) => {
      resume(Effect.succeedSome({ code, output }));
    });

    return Effect.sync(() => {
      child.kill("SIGTERM");
    });
  });

const lastLine = (output: string) =>
  output.trim().split("\n").at(-1)?.trim() ?? "";

export interface Repository {
  // "created": a new repository with the template committed; "existing": `dir` was
  // already in one, which is left alone; "unavailable": git is not installed.
  readonly repository: "created" | "existing" | "unavailable";
  readonly warning: string | undefined;
}

// Makes `dir` a repository of its own with everything in it committed, unless it is
// already inside one: a template inside a project's repository joins that one.
export const initRepository = (dir: string, message: string) =>
  Effect.gen(function* () {
    const inside = yield* exec(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      dir
    );

    if (Option.isNone(inside)) {
      return {
        repository: "unavailable",
        warning: "git is not installed, so the folder is not a repository.",
      } satisfies Repository;
    }

    if (inside.value.code === 0) {
      return {
        repository: "existing",
        warning: undefined,
      } satisfies Repository;
    }

    const steps = [
      ["init", "--quiet"],
      ["add", "--all"],
      ["commit", "--quiet", "--message", message],
    ] as const;

    for (const args of steps) {
      const ran = yield* exec("git", args, dir);

      if (Option.isNone(ran) || ran.value.code !== 0) {
        const reason = Option.match(ran, {
          onNone: () => "git stopped working",
          onSome: (failed) => lastLine(failed.output),
        });

        return {
          repository: "created",
          warning: `Could not make the first commit (git ${args[0]}: ${reason}). Commit the files yourself.`,
        } satisfies Repository;
      }
    }

    return { repository: "created", warning: undefined } satisfies Repository;
  });

export interface Installed {
  readonly installed: boolean;
  readonly warning: string | undefined;
}

// Installs the packages with pnpm (or pnpm through Corepack). A failure is reported,
// never raised: the project is usable, and the install can be run by hand.
export const installDependencies = (dir: string) =>
  withProgress(
    "Installing dependencies with pnpm (this can take a few minutes)…",
    "Dependencies installed.",
    Effect.gen(function* () {
      const launchers = [
        ["pnpm", ["install"]],
        ["corepack", ["pnpm", "install"]],
      ] as const;

      for (const [program, args] of launchers) {
        const ran = yield* exec(program, args, dir);

        if (Option.isNone(ran)) {
          continue;
        }

        return ran.value.code === 0
          ? ({ installed: true, warning: undefined } satisfies Installed)
          : ({
              installed: false,
              warning: `pnpm install failed: ${lastLine(ran.value.output)}`,
            } satisfies Installed);
      }

      return {
        installed: false,
        warning:
          "pnpm is not installed, so dependencies were not installed. Install pnpm (https://pnpm.io/installation), then run pnpm install.",
      } satisfies Installed;
    })
  );

export interface FinishSpec {
  readonly dir: string;
  readonly downloaded: Downloaded | undefined;
  // Whether to install its packages now.
  readonly install: boolean;
  // The folder to make a repository of, if any: the copy, or the project around it.
  readonly repository: string | undefined;
  readonly template: Template;
}

// What every copy of a template ends with: a repository with the template as its first
// commit, its packages, what to run next, and where it came from. Nothing here fails:
// each step that cannot be done is a warning.
export const finishCopy = (spec: FinishSpec) =>
  Effect.gen(function* () {
    // Where the files came from: the commit when the download said, else the branch.
    // Kept in the first commit's message and the result, not in saleor.yml.
    const source = templateSource(
      spec.template,
      spec.downloaded ?? { commit: undefined }
    );

    const repository =
      spec.repository === undefined
        ? undefined
        : yield* initRepository(spec.repository, `Start from ${source}`);

    const installed = spec.install
      ? yield* installDependencies(spec.dir)
      : undefined;

    const dependenciesInstalled =
      installed?.installed ?? existsSync(path.join(spec.dir, "node_modules"));

    const cd = shown(spec.dir);

    return {
      installed: dependenciesInstalled,
      next: [
        ...(cd === "." ? [] : [`cd ${cd}`]),
        ...(dependenciesInstalled ? [] : ["pnpm install"]),
        "pnpm dev",
      ],
      repository: repository?.repository ?? null,
      template: {
        commit: spec.downloaded?.commit ?? null,
        ref: spec.template.ref,
        repository: spec.template.repository,
      },
      warnings: [repository?.warning, installed?.warning].filter(
        (warning): warning is string => warning !== undefined
      ),
    };
  });
