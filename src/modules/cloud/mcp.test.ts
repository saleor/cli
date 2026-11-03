import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { saleorMcp } from "./mcp.ts";
import { cloudSetup } from "./setup.ts";

const UNRELEASED_MCP_COPY = /preview|coming soon|when released/i;

afterEach(() => {
  vi.restoreAllMocks();
});

it("offers Saleor MCP on the Cloud onboarding path, with a mocked backend", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

  expect(cloudSetup.onboarding?.agentTool).toBe(saleorMcp);
  expect(cloudSetup.onboarding?.first).toStrictEqual(["login"]);

  await Effect.runPromise(saleorMcp.install("Codex"));

  const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join("");

  expect(output).toContain("Saleor MCP is configured for Codex.");
  expect(output).not.toMatch(UNRELEASED_MCP_COPY);
  expect(`${saleorMcp.offer} ${saleorMcp.question}`).not.toMatch(
    UNRELEASED_MCP_COPY
  );
});
