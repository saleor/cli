import { Context } from "effect";
import { accessSync, constants, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CodingAgent {
  readonly detected: boolean;
  readonly id: string;
  readonly label: string;
  readonly skillsDirectory: (scope: "project" | "user") => string;
}

const executable = (name: string, env: NodeJS.ProcessEnv) =>
  (env.PATH ?? "").split(path.delimiter).some((directory) => {
    if (!directory) {
      return false;
    }

    try {
      accessSync(path.join(directory, name), constants.X_OK);

      return true;
    } catch {
      return false;
    }
  });

// Detection is a hint, never consent to change an agent's configuration. Include
// undetected agents too: GUI installations need not put a binary on PATH.
export const detectCodingAgents = (
  home = os.homedir(),
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): readonly CodingAgent[] => {
  const codexHome = env.CODEX_HOME ?? path.join(home, ".codex");
  const claudeHome = env.CLAUDE_CONFIG_DIR ?? path.join(home, ".claude");

  const definitions = [
    {
      active: Boolean(env.CLAUDECODE) || Boolean(env.CLAUDE_CODE_ENTRYPOINT),
      binary: "claude",
      configHome: claudeHome,
      directory: ".claude",
      id: "claude",
      label: "Claude Code",
      userSkills: path.join(claudeHome, "skills"),
    },
    {
      active: Boolean(env.CODEX_THREAD_ID) || Boolean(env.CODEX_SESSION_ID),
      binary: "codex",
      configHome: codexHome,
      directory: ".agents",
      id: "codex",
      label: "Codex",
      userSkills: path.join(home, ".agents", "skills"),
    },
    {
      active: Boolean(env.CURSOR_AGENT),
      binary: "cursor",
      configHome: path.join(home, ".cursor"),
      directory: ".cursor",
      id: "cursor",
      label: "Cursor",
      userSkills: path.join(home, ".cursor", "skills"),
    },
  ];

  return definitions.map((agent) => ({
    detected:
      agent.active ||
      existsSync(agent.configHome) ||
      existsSync(
        path.join(cwd, agent.id === "codex" ? ".codex" : agent.directory)
      ) ||
      executable(agent.binary, env),
    id: agent.id,
    label: agent.label,
    skillsDirectory: (scope) =>
      scope === "user"
        ? agent.userSkills
        : path.join(cwd, agent.directory, "skills"),
  }));
};

export const CodingAgents = Context.Reference<readonly CodingAgent[]>(
  "saleor/CodingAgents",
  { defaultValue: () => detectCodingAgents() }
);
