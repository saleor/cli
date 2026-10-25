import { Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, expect, it } from "vitest";
import { OutputFlag } from "../../core/output.ts";
import { deadlineIn, probeGraphql } from "../../core/readiness.ts";
import { CloudApi, type CloudApiService } from "./api/client.ts";
import { ListProjectResponse } from "./api/contract.ts";
import samples from "./api/fixtures/cloud-samples.json" with { type: "json" };
import {
  applyEnvironment,
  billingNotice,
  type EnvironmentInput,
  planEnvironment,
} from "./provision.ts";

const ensureEnvironment = (input: EnvironmentInput) =>
  Effect.flatMap(planEnvironment(input), (planned) =>
    applyEnvironment(input, planned, deadlineIn(1))
  );

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

// The CLI does not price anything: outside the free plan it only says that a new
// environment might be charged, depending on the plan.
it.each([
  [0, undefined],
  [
    1,
    "Depending on your plan (pro), you might be charged for this environment.",
  ],
])("tells about billing for plan %i", (plan, notice) => {
  expect(
    billingNotice(
      Schema.decodeUnknownSync(ListProjectResponse)({
        ...samples.project,
        plan: samples.plans[plan],
      })
    )
  ).toBe(notice);
});

describe("provisioning recovery", () => {
  const project = Schema.decodeUnknownSync(ListProjectResponse)({
    ...samples.project,
    plan: samples.plans[0],
  });

  const environment = { ...samples.environment, project };
  it.each([false, true])(
    "reuses Cloud state without another write (paid=%s)",
    async (paid) => {
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
          domainLabel: Option.none(),
          name: environment.name,
          organization: "acme",
          project: paid
            ? {
                ...project,
                plan: Schema.decodeUnknownSync(ListProjectResponse)({
                  ...samples.project,
                  plan: samples.plans[1],
                }).plan,
              }
            : project,
        }).pipe(
          Effect.provideService(OutputFlag, Option.some("json")),
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
    }
  );
  it.each([false, true])(
    "creates and waits for readiness (paid=%s)",
    async (paid) => {
      const calls: string[] = [];
      let created = false;

      const api = mockApi((operation) => {
        calls.push(operation.path);

        if (operation.path.endsWith("/obtain/")) {
          created = true;

          return {
            ...environment,
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
          domainLabel: Option.none(),
          name: environment.name,
          organization: "acme",
          project: paid
            ? {
                ...project,
                plan: Schema.decodeUnknownSync(ListProjectResponse)({
                  ...samples.project,
                  plan: samples.plans[1],
                }).plan,
              }
            : project,
        }).pipe(
          Effect.provideService(OutputFlag, Option.some("json")),
          Effect.provideService(CloudApi, api),
          Effect.provideService(
            HttpClient.HttpClient,
            http({ data: { shop: { name: "Store" } } })
          )
        )
      );

      expect(outcome.created).toBe(true);
      expect(calls.filter((route) => route.endsWith("/obtain/"))).toHaveLength(
        1
      );
      expect(calls).toContain("/api/service/task-status/{job_name}/");
    }
  );
});
