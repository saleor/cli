import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { detectCodingAgents } from "./agents.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

it("detects config directories and binaries without executing them", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "saleor-agents-"));
  dirs.push(dir);
  mkdirSync(path.join(dir, ".claude"));
  mkdirSync(path.join(dir, "bin"));
  writeFileSync(path.join(dir, "bin", "codex"), "do not execute", {
    mode: 0o755,
  });
  const agents = detectCodingAgents(dir, dir, { PATH: path.join(dir, "bin") });
  expect(agents.map(({ id, detected }) => ({ detected, id }))).toEqual([
    { detected: true, id: "claude" },
    { detected: true, id: "codex" },
    { detected: false, id: "cursor" },
  ]);
  expect(agents[1]?.skillsDirectory("project")).toBe(
    path.join(dir, ".agents", "skills")
  );
  expect(agents[1]?.skillsDirectory("user")).toBe(
    path.join(dir, ".agents", "skills")
  );
});

it("honors custom configuration homes and agent environment hints", () => {
  const agents = detectCodingAgents("/unused/home", "/unused/project", {
    CLAUDE_CONFIG_DIR: "/custom/claude",
    CLAUDECODE: "1",
    CODEX_THREAD_ID: "test",
    CURSOR_AGENT: "1",
    PATH: "",
  });

  expect(agents.every((agent) => agent.detected)).toBe(true);
  expect(agents[0]?.skillsDirectory("user")).toBe("/custom/claude/skills");
});
