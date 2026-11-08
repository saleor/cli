import { expect, it } from "vitest";
import {
  classifyInstall,
  decideInstall,
  type InstalledApp,
  type Installation,
} from "./store.ts";

const manifestUrl = "https://app.example.com/api/manifest";
const wanted = { installationId: "inst-1", manifestUrl };

const app: InstalledApp = {
  id: "app-1",
  identifier: "example",
  isActive: true,
  manifestUrl,
  name: "Example",
  type: "THIRDPARTY",
};

const installation = (status: string): Installation => ({
  appName: "Example",
  id: "inst-1",
  manifestUrl,
  message: status === "FAILED" ? "Manifest unreachable" : null,
  status,
});

const decide = decideInstall("local:demo");

it.each([
  ["Installing", { apps: [], installations: [installation("PENDING")] }],
  ["Installing", { apps: [], installations: [installation("SUCCESS")] }],
  ["Installed", { apps: [app], installations: [installation("SUCCESS")] }],
  ["Installed", { apps: [app], installations: [] }],
  ["Failed", { apps: [app], installations: [installation("FAILED")] }],
  ["Lost", { apps: [], installations: [] }],
] as const)("classifies as %s", (tag, seen) => {
  expect(classifyInstall(seen, wanted)._tag).toBe(tag);
});

it("is done with the installed app", () => {
  const step = decide(
    classifyInstall({ apps: [app], installations: [] }, wanted)
  );

  expect(step._tag).toBe("Done");
  expect(step).toMatchObject({ value: app });
});

it("keeps waiting while Saleor installs", () => {
  const step = decide(
    classifyInstall(
      { apps: [], installations: [installation("PENDING")] },
      wanted
    )
  );

  expect(step._tag).toBe("Wait");
});

it("fails with Saleor's message when the installation failed", () => {
  const step = decide(
    classifyInstall(
      { apps: [], installations: [installation("FAILED")] },
      wanted
    )
  );

  expect(step._tag).toBe("Fail");
  expect(step).toMatchObject({
    failure: {
      code: "STORE_ERROR",
      message: "local:demo could not install Example: Manifest unreachable",
    },
  });
});

it("fails when the installation finished without the app", () => {
  const step = decide(classifyInstall({ apps: [], installations: [] }, wanted));

  expect(step._tag).toBe("Fail");
  expect(step).toMatchObject({ failure: { code: "STORE_ERROR" } });
});
