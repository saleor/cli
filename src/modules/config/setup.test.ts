import { Effect, Option } from "effect";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { StoreSources } from "../../core/store.ts";
import { OutputFlag } from "../../core/output.ts";
import { SecretStore } from "../../core/secret-store.ts";
import { prepareSampleData, sampleConfiguration } from "./setup.ts";

it.each([true, false])(
  "restores sample data only when the provider has not supplied it (%s)",
  async (sampleDataReady) => {
    const populate = vi.fn(() => Effect.void);

    const store = {
      created: true,
      dashboardUrl: "https://example.com/dashboard/",
      graphqlUrl: "https://example.com/graphql/",
      kind: "cloud" as const,
      name: "test",
      ready: true,
      ref: "cloud:org/key",
      saleorVersion: "3.23.41",
      sampleDataReady,
      state: "ready" as const,
    };

    await Effect.runPromise(
      prepareSampleData(store).pipe(
        Effect.provideService(StoreSources, [
          {
            find: () => Effect.die("unused"),
            kind: "cloud",
            label: "Cloud",
            list: Effect.succeed([]),
            populate,
          },
        ])
      )
    );
    expect(populate).toHaveBeenCalledTimes(sampleDataReady ? 0 : 1);
  }
);

it("skips the sample export without credentials and preserves the existing file", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "saleor-skip-sample-"));
  const file = path.join(directory, "config.yml");
  writeFileSync(file, "shop: {name: Existing}\n");

  try {
    // Credential access fails the test; skipping must not require any store connection.
    const outcome = await Effect.runPromise(
      sampleConfiguration(
        {
          created: true,
          dashboardUrl: "https://example.com/dashboard/",
          graphqlUrl: "https://example.com/graphql/",
          kind: "cloud",
          name: "sample",
          ready: true,
          ref: "cloud:org/key",
          saleorVersion: "3.23.41",
          sampleDataReady: true,
          state: "ready",
        },
        file,
        false
      ).pipe(
        Effect.provideService(StoreSources, []),
        Effect.provideService(OutputFlag, Option.some("json")),
        Effect.provideService(SecretStore, {
          backend: "file",
          get: () => Effect.die("Unexpected credential lookup"),
          remove: () => Effect.die("Unexpected credential removal"),
          set: () => Effect.die("Unexpected credential write"),
        })
      )
    );

    expect(outcome.config).toBeNull();
    expect((outcome.brief.next ?? []).join("\n")).toContain(
      "saleor config pull cloud:org/key"
    );
    expect(readFileSync(file, "utf-8")).toBe("shop: {name: Existing}\n");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
