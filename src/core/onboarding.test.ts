import { CANCEL_SYMBOL } from "@clack/prompts";
import { Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SkillInstaller, type SkillsInstalled } from "./agent-skills.ts";
import { CodingAgents } from "./agents.ts";
import { type CliFailure, fail } from "./errors.ts";
import { Prompts } from "./interaction.ts";
import { onboard } from "./onboarding.ts";

const dirs: string[] = [];
const UNRELEASED_MCP_COPY = /preview|coming soon|when released/i;

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }

  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = 0;
});

const setup = (answer: string | symbol) => {
  const dir = mkdtempSync(path.join(tmpdir(), "saleor-onboard-"));
  dirs.push(dir);
  vi.stubEnv("SALEOR_CONFIG_DIR", dir);
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  const select = vi.fn(async () => answer);
  const confirm = vi.fn(async () => false);
  const execute = vi.fn(() => Effect.void);

  const install = vi.fn(
    (_directory: string): Effect.Effect<SkillsInstalled, CliFailure> =>
      Effect.succeed({ installed: ["saleor-app"], skipped: [] })
  );

  const run = async (force = false) =>
    await Effect.runPromise(
      onboard(execute, force).pipe(
        Effect.provideService(CodingAgents, [
          {
            detected: true,
            id: "codex",
            label: "Codex",
            skillsDirectory: (scope) => path.join(dir, scope, "skills"),
          },
        ]),
        Effect.provideService(SkillInstaller, { install }),
        Effect.provideService(Prompts, {
          confirm,
          select,
          text: async () => "",
        })
      )
    );

  return { confirm, dir, execute, install, run, select };
};

it("remembers local onboarding and allows explicitly revisiting it", async () => {
  const { run, select, execute, dir } = setup("local");
  expect(await run()).toBe(true);
  expect(execute).not.toHaveBeenCalled();
  expect(
    JSON.parse(readFileSync(path.join(dir, "onboarding.json"), "utf-8"))
  ).toStrictEqual({ version: 1 });
  await run();
  expect(select).toHaveBeenCalledOnce();
  await run(true);
  expect(select).toHaveBeenCalledTimes(2);
});

it("browses commands without login or agent setup", async () => {
  const { run, confirm, select, execute, install } = setup("skip");
  expect(await run()).toBe(true);
  expect(select).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      choices: [
        expect.objectContaining({ value: "cloud" }),
        expect.objectContaining({ value: "local" }),
        expect.objectContaining({
          label: "Browse commands",
          value: "skip",
        }),
      ],
    })
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(install).not.toHaveBeenCalled();
});

it("leaves failed Cloud login retryable", async () => {
  const { run, execute, select } = setup("cloud");
  execute.mockImplementation(() =>
    Effect.sync(() => {
      process.exitCode = 1;
    })
  );
  expect(await run()).toBe(false);
  expect(execute).toHaveBeenCalledWith(["login"]);
  process.exitCode = 0;
  await run();
  expect(select).toHaveBeenCalledTimes(2);
});

it("leaves cancelled onboarding retryable", async () => {
  const { run, select } = setup(CANCEL_SYMBOL);
  await expect(run()).rejects.toThrow(/interrupt/i);
  await expect(run()).rejects.toThrow(/interrupt/i);
  expect(select).toHaveBeenCalledTimes(2);
});

it("installs skills for local users without offering Cloud MCP", async () => {
  const { run, select, confirm, install, dir } = setup("local");
  confirm.mockResolvedValue(true);
  select
    .mockResolvedValueOnce("local")
    .mockResolvedValueOnce("codex")
    .mockResolvedValueOnce("project");
  expect(await run()).toBe(true);
  expect(confirm).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Install Saleor skills in your coding agent?",
    })
  );
  expect(install).toHaveBeenCalledWith(path.join(dir, "project", "skills"));
});

it("offers Cloud MCP installation independently of skills with a mocked backend", async () => {
  const { run, select, confirm, install, execute, dir } = setup("cloud");
  confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  select.mockResolvedValueOnce("cloud").mockResolvedValueOnce("codex");
  expect(await run()).toBe(true);
  expect(execute).toHaveBeenCalledExactlyOnceWith(["login"]);
  expect(install).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "Install Saleor MCP in your coding agent?",
    })
  );
  expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(
    expect.stringContaining("Installing Saleor MCP for Codex")
  );
  expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(
    expect.stringContaining("Saleor MCP is configured for Codex.")
  );

  const output = vi
    .mocked(process.stderr.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .join("");

  expect(output).not.toMatch(UNRELEASED_MCP_COPY);
  expect(
    readFileSync(path.join(dir, "onboarding.json"), "utf-8")
  ).not.toContain("mcp");
});

it("does not mark onboarding complete when skills installation fails", async () => {
  const { run, select, confirm, install, dir } = setup("local");
  confirm.mockResolvedValue(true);
  select
    .mockResolvedValueOnce("local")
    .mockResolvedValueOnce("codex")
    .mockResolvedValueOnce("user");
  // Return a typed failure through the same service the real installer uses.
  install.mockImplementation(() =>
    Effect.fail(fail("UNAVAILABLE", "Download failed."))
  );
  expect(await run()).toBe(false);
  expect(existsSync(path.join(dir, "onboarding.json"))).toBe(false);
  expect(process.exitCode).toBe(1);
  expect(vi.mocked(process.stderr.write)).toHaveBeenCalledWith(
    expect.stringContaining("Download failed")
  );
});
