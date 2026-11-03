import { Effect } from "effect";
import { notice, withProgress } from "../../core/output.ts";
import type { AgentTool } from "../../core/setup.ts";

// Saleor MCP, offered to coding agents on the Cloud onboarding path.
//
// Prototype backend: shows the intended installation experience until MCP v2's app
// installation and agent authorization are wired in. Nothing is installed and no
// configuration is written.
const mockInstallation = Effect.sleep("400 millis");

export const saleorMcp: AgentTool = {
  install: (agent) =>
    Effect.gen(function* () {
      yield* withProgress(
        `Installing Saleor MCP for ${agent}…`,
        "Saleor MCP is ready.",
        mockInstallation
      );

      yield* notice(
        `Saleor MCP is configured for ${agent}.\nRestart ${agent} to connect to Saleor Cloud.`
      );
    }),
  offer: "Saleor MCP connects your coding agent to your Saleor Cloud store.",
  question: "Install Saleor MCP in your coding agent?",
};
