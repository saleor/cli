import { Effect } from "effect";
import { SkillInstaller } from "./agent-skills.ts";
import { CodingAgents } from "./agents.ts";
import { askConfirm, askSelect } from "./interaction.ts";
import { onboardingSection } from "./onboarding-presentation.ts";
import { notice, withProgress } from "./output.ts";
import type { AgentTool } from "./setup.ts";

// Skills for any coding agent, and the tool the chosen onboarding path offers besides,
// if any: only the path picked decides, never a saved login.
export const setupCodingAgent = (tool: AgentTool | undefined) =>
  Effect.gen(function* () {
    yield* onboardingSection(
      "02",
      "Your coding agent",
      "Skills provide Saleor guidance for apps, storefronts, and store configuration."
    );

    const skills = yield* askConfirm(
      "Install Saleor skills in your coding agent?"
    );

    if (tool !== undefined) {
      yield* notice(tool.offer);
    }

    const withTool =
      tool !== undefined && (yield* askConfirm(tool.question, false));

    if (!(skills || withTool)) {
      return true;
    }

    const agents = yield* CodingAgents;

    const ordered = [...agents].sort(
      (a, b) => Number(b.detected) - Number(a.detected)
    );

    const selected = yield* askSelect({
      choices: [
        ...ordered.map((candidate) => ({
          hint: candidate.detected ? "Found on this computer" : "Not detected",
          label: candidate.label,
          value: candidate.id,
        })),
        { label: "Skip agent setup", value: "skip" },
      ],
      message: "Which coding agent do you use?",
    });

    const agent = agents.find((entry) => entry.id === selected);

    if (agent === undefined) {
      return true;
    }

    if (skills) {
      const scope = yield* askSelect({
        choices: [
          {
            hint: agent.skillsDirectory("project"),
            label: "Current project",
            value: "project",
          },
          {
            hint: agent.skillsDirectory("user"),
            label: "All your projects",
            value: "user",
          },
          { label: "Skip skills installation", value: "skip" },
        ],
        message: "Where should the skills be installed?",
      });

      if (scope === "project" || scope === "user") {
        const installer = yield* SkillInstaller;
        const directory = agent.skillsDirectory(scope);
        yield* notice(
          `Installing Saleor skills for ${agent.label} in ${directory}…`
        );

        const installed = yield* withProgress(
          `Installing Saleor skills for ${agent.label}…`,
          "Saleor skills are ready.",
          installer.install(directory)
        ).pipe(
          Effect.match({
            onFailure: (error) => ({ error, ok: false as const }),
            onSuccess: (value) => ({ ok: true as const, value }),
          })
        );

        if (!installed.ok) {
          yield* notice(installed.error.message);
          process.exitCode = 1;

          return false;
        }

        yield* notice(
          `Installed ${installed.value.installed.length} Saleor skills. Preserved ${installed.value.skipped.length} existing skills.\nRestart ${agent.label} to load new skills.`
        );
      }
    }

    if (withTool && tool !== undefined) {
      yield* tool.install(agent.label);
    }

    return true;
  });
