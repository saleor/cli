import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { Session } from "../auth/session.ts";
import { CloudApi, CloudApiLive, type CloudApiService } from "./client.ts";
import { createCreateProject, listOrganizations } from "./contract.ts";

const session = Layer.succeed(Session, {
  clearPendingGrant: Effect.void,
  credential: Effect.succeed({
    scheme: "Token" as const,
    source: "env" as const,
    token: "test",
  }),
  logout: Effect.succeed({ removed: false }),
  pendingGrant: Effect.succeed(undefined),
  saveLogin: () => Effect.void,
  savePendingGrant: () => Effect.void,
  status: Effect.succeed({ source: "env" as const, store: "test" }),
});

const run = (
  call: (api: CloudApiService) => Effect.Effect<unknown, unknown>,
  body: Schema.Json = []
) => {
  let requests = 0;

  const http = HttpClient.make((request) => {
    requests += 1;

    return Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json(body))
    );
  });

  const result = Effect.gen(function* () {
    return yield* call(yield* CloudApi);
  }).pipe(
    Effect.provide(
      CloudApiLive.pipe(
        Layer.provide(session),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, http))
      )
    ),
    Effect.result,
    Effect.runPromise
  );

  return { requests: () => requests, result };
};

describe("Cloud API wire boundary", () => {
  it.each([
    { path: { organization_slug: "acme" } },
    { body: { name: "shop", plan: "dev", region: "eu" }, path: {} },
    {
      body: { name: "shop", plan: "dev", region: "eu" },
      path: { organization_slug: 42 },
    },
    {
      body: { name: 42, plan: "dev", region: "eu" },
      path: { organization_slug: "acme" },
    },
    {
      body: { internal: true, name: "shop", plan: "dev", region: "eu" },
      path: { organization_slug: "acme" },
    },
    {
      body: { name: "shop", plan: "dev", region: "eu" },
      path: { organization_slug: "acme" },
      query: { internal: "true" },
    },
  ])("rejects invalid requests before HTTP: %j", async (options) => {
    // SAFETY: deliberately bypass static typing to exercise runtime request validation.
    const test = run((api) => api.call(createCreateProject, options as never));
    expect(await test.result).toMatchObject({
      failure: { code: "INTERNAL_ERROR" },
    });
    expect(test.requests()).toBe(0);
  });

  it("rejects a body on a bodyless operation", async () => {
    // SAFETY: deliberately invalid input verifies the runtime boundary.
    const test = run((api) =>
      api.call(listOrganizations, { body: {} } as never)
    );

    expect(await test.result).toMatchObject({
      failure: { code: "INTERNAL_ERROR" },
    });
    expect(test.requests()).toBe(0);
  });

  it("accepts minimal responses and discards unrelated fields", async () => {
    const test = run(
      (api) => api.call(listOrganizations),
      [{ name: "Acme", slug: "acme", unrelated: { anything: true } }]
    );

    expect(await test.result).toMatchObject({
      success: [{ name: "Acme", slug: "acme" }],
    });
    expect(
      Schema.decodeUnknownSync(listOrganizations.response)([
        { name: "Acme", slug: "acme", unrelated: true },
      ])
    ).toEqual([{ name: "Acme", slug: "acme" }]);
  });

  it("rejects malformed fields the CLI consumes", async () => {
    const test = run(
      (api) => api.call(listOrganizations),
      [{ name: "Acme", slug: 42 }]
    );

    expect(await test.result).toMatchObject({
      failure: { code: "API_ERROR" },
    });
  });

  it("sends valid create requests and reads only the needed result", async () => {
    const test = run(
      (api) =>
        api.call(createCreateProject, {
          body: { name: "shop", plan: "dev", region: "eu" },
          path: { organization_slug: "acme" },
        }),
      { slug: "shop" }
    );

    expect(await test.result).toMatchObject({
      success: { slug: "shop" },
    });
    expect(test.requests()).toBe(1);
  });
});
