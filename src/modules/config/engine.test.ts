import { Effect, Schema } from "effect";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instance } from "../../core/instance.ts";
import { applyDeploy, planDeploy } from "./deploying.ts";
import { deploy, diff, pull, serialize, validateFile } from "./engine.ts";

const store = { token: "store-secret", url: "https://store.test/graphql/" };

describe("Configurator library adapter", () => {
  let directory: string;
  let file: string;
  let sender: string;
  let rejectUpdate: boolean;
  let mutations: unknown[];

  beforeEach(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "saleor-library-test-"));
    file = path.join(directory, "config.yml");
    writeFileSync(file, "shop:\n  defaultMailSenderName: New store\n");
    sender = "Old store";
    rejectUpdate = false;
    mutations = [];

    // Exercise the installed library's real services, diff and deployment pipeline.
    // Only the Saleor transport is replaced.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(url instanceof Request ? url.url : String(url)).toBe(store.url);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${store.token}`
      );

      const body = JSON.parse(
        Schema.decodeUnknownSync(Schema.String)(init?.body)
      );

      const connection = {
        edges: [],
        pageInfo: { endCursor: null, hasNextPage: false },
      };

      if (body.query.includes("mutation UpdateShopSettings")) {
        mutations.push(body.variables.input);

        if (!rejectUpdate) {
          sender = body.variables.input.defaultMailSenderName;
        }

        return Response.json({
          data: {
            shopSettingsUpdate: {
              errors: rejectUpdate
                ? [
                    {
                      code: "INVALID",
                      field: "defaultMailSenderName",
                      message: "Rejected",
                    },
                  ]
                : [],
              shop: { defaultMailSenderName: sender },
            },
          },
        });
      }

      return Response.json({
        data: {
          attributes: connection,
          channels: [],
          customerTypes: connection,
          products: connection,
          shop: { defaultMailSenderName: sender, schemaVersion: "3.23.41" },
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { force: true, recursive: true });
  });

  it("pulls, serializes, diffs and deploys through the public library without extra files or output", async () => {
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write");
    const pulled = await Effect.runPromise(pull(store));
    expect(pulled.shop).toStrictEqual({ defaultMailSenderName: "Old store" });
    expect(await Effect.runPromise(serialize(pulled))).toContain("Old store");

    const summary = await Effect.runPromise(diff(store, file));
    expect(summary).toMatchObject({ totalChanges: 1, updates: 1 });
    expect(summary.results[0]).toMatchObject({
      entityType: "Shop Settings",
      operation: "UPDATE",
    });

    const outcome = await Effect.runPromise(deploy(store, file, summary));
    expect(outcome.exitCode).toBe(0);
    expect(outcome.result.overallStatus).toBe("success");
    expect(mutations).toStrictEqual([{ defaultMailSenderName: "New store" }]);
    expect(await Effect.runPromise(diff(store, file))).toMatchObject({
      totalChanges: 0,
    });
    expect(readdirSync(directory)).toStrictEqual(["config.yml"]);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("maps library validation failures to the CLI contract before any network call", async () => {
    writeFileSync(file, "channels: invalid\n");
    const failure = await Effect.runPromise(Effect.flip(validateFile(file)));
    expect(failure).toMatchObject({ code: "CONFIG_INVALID", retry: false });
    expect(failure.suggestion).toContain("config validate");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("reports returned deployment failures rather than marking the project in sync", async () => {
    rejectUpdate = true;
    const plan = await Effect.runPromise(planDeploy(store, file));

    const target = instance({
      dashboardUrl: "https://store.test/dashboard/",
      graphqlUrl: store.url,
      kind: "local",
      name: "test",
      ref: "local:test",
      saleorVersion: "3.23.41",
      state: "ready",
    });

    const failure = await Effect.runPromise(
      Effect.flip(applyDeploy({ instance: target, store, file, plan }))
    );

    expect(failure).toMatchObject({ code: "DEPLOY_PARTIAL", retry: false });
    expect(failure.details).toMatchObject({ exitCode: expect.any(Number) });
    expect(mutations).toHaveLength(1);
  });
});
