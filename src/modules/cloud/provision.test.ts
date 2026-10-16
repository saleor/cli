import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { deadlineIn, probeGraphql } from "../../core/readiness.ts";
import { CloudApi, type CloudApiService } from "./api/client.ts";
import samples from "./api/fixtures/cloud-samples.json" with { type: "json" };
import { ListProjectResponse } from "./api/generated.ts";
import { ensureEnvironment } from "./provision.ts";

const mockApi = (
  respond: (operation: { path: string; method: string }) => Schema.Json
): CloudApiService => {
  const call = (operation: Parameters<CloudApiService["call"]>[0]) => {
    const body = respond(operation);

    return operation.response === undefined
      ? Effect.void
      : Schema.decodeEffect(operation.response)(body).pipe(Effect.orDie);
  };

  // SAFETY: this adapter decodes each fixture through the operation's response schema, preserving the same operation/result association as CloudApiLive.
  return { call: call as CloudApiService["call"] };
};

const http = (body: Schema.Json, status = 200) =>
  HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, Response.json(body, { status }))
    )
  );

it.each([
  [200, { data: { shop: { name: "Store" } } }, true],
  [200, { data: { shop: null }, errors: [{ message: "Starting" }] }, false],
  [200, { errors: [{ message: "Unavailable" }] }, false],
  [503, {}, false],
  [200, { data: { shop: "invalid" } }, false],
  [200, { data: { shop: {} } }, false],
])("checks a real GraphQL payload (HTTP %i)", async (status, body, ready) => {
  expect(
    await Effect.runPromise(
      probeGraphql("https://test.saleor.cloud/graphql/").pipe(
        Effect.provideService(HttpClient.HttpClient, http(body, status))
      )
    )
  ).toBe(ready);
});

describe("provisioning recovery", () => {
  const project = Schema.decodeUnknownSync(ListProjectResponse)({
    ...samples.project,
    plan: samples.plans[0],
  });

  const environment = { ...samples.environment, project };
  it("reuses Cloud state after losing a create reply, rechecking readiness without another write", async () => {
    const calls: string[] = [];

    const api = mockApi((operation) => {
      calls.push(operation.path);

      if (operation.path.endsWith("/environments/")) {
        return [environment];
      }

      if (operation.path.endsWith("/tasks/")) {
        return { count: 0, results: [] };
      }

      throw new Error(`Unexpected operation: ${operation.path}`);
    });

    const outcome = await Effect.runPromise(
      ensureEnvironment({
        deadline: deadlineIn(1),
        domainLabel: Option.none(),
        name: environment.name,
        organization: "acme",
        project,
        service: Option.none(),
      }).pipe(
        Effect.provideService(CloudApi, api),
        Effect.provideService(
          HttpClient.HttpClient,
          http({ data: { shop: { name: "Store" } } })
        )
      )
    );

    expect(outcome.created).toBe(false);
    expect(outcome.environment.key).toBe(environment.key);
    expect(calls).toHaveLength(3);
  });
  it("waits for a newly created environment's task, then checks GraphQL", async () => {
    const calls: string[] = [];
    let created = false;

    const api = mockApi((operation) => {
      calls.push(operation.path);

      if (operation.path.endsWith("/obtain/")) {
        created = true;

        return {
          ...environment,
          project: project.url,
          service: environment.service.url,
          task_id: "task",
          task_is_blocking: true,
        };
      }

      if (operation.path.endsWith("/environments/")) {
        return created ? [environment] : [];
      }

      if (operation.path.endsWith("/services/")) {
        return samples.services;
      }

      if (operation.path.includes("/task-status/")) {
        return { ...samples.taskStatus, status: "SUCCEEDED" };
      }

      if (operation.path.endsWith("/tasks/")) {
        return { count: 0, results: [] };
      }

      throw new Error(`Unexpected operation: ${operation.path}`);
    });

    const outcome = await Effect.runPromise(
      ensureEnvironment({
        deadline: deadlineIn(1),
        domainLabel: Option.none(),
        name: environment.name,
        organization: "acme",
        project,
        service: Option.none(),
      }).pipe(
        Effect.provideService(CloudApi, api),
        Effect.provideService(
          HttpClient.HttpClient,
          http({ data: { shop: { name: "Store" } } })
        )
      )
    );

    expect(outcome.created).toBe(true);
    expect(calls.filter((route) => route.endsWith("/obtain/"))).toHaveLength(1);
    expect(calls).toContain("/api/service/task-status/{job_name}/");
  });
});
