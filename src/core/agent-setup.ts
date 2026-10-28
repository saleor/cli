import { Effect } from "effect";
import { SkillInstaller } from "./agent-skills.ts";
import { CodingAgents } from "./agents.ts";
import { askConfirm, askSelect } from "./interaction.ts";
import { onboardingSection } from "./onboarding-presentation.ts";
import { notice, withProgress } from "./output.ts";

// Prototype backend: show the intended installation experience until MCP v2's
// app installation and agent authorization are wired in. No configuration writes.
const mockMcpInstallation = Effect.sleep("400 millis");

// Cloud eligibility comes from the onboarding path after successful login. Local
// onboarding never offers the Cloud MCP, even if a saved Cloud session exists.
export const setupCodingAgent = (cloud: boolean) =>
  Effect.gen(function* () {
    yield* onboardingSection(
      "02",
      "Your coding agent",
      "Skills provide Saleor guidance for apps, storefronts, and store configuration."
    );

    const skills = yield* askConfirm(
      "Install Saleor skills in your coding agent?"
    );

    if (cloud) {
      yield* notice(
        "Saleor MCP connects your coding agent to your Saleor Cloud store."
      );
    }

    const mcp =
      cloud &&
      (yield* askConfirm("Install Saleor MCP in your coding agent?", false));

    if (!(skills || mcp)) {
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

    if (mcp) {
      yield* withProgress(
        `Installing Saleor MCP for ${agent.label}…`,
        "Saleor MCP is ready.",
        mockMcpInstallation
      );

      yield* notice(
        `Saleor MCP is configured for ${agent.label}.\nRestart ${agent.label} to connect to Saleor Cloud.`
      );
    }

    return true;
  });
