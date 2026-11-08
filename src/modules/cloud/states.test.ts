import { Effect, Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fail } from "../../core/errors.ts";
import { EnvironmentResponse } from "./api/contract.ts";
import samples from "./api/fixtures/cloud-samples.json" with { type: "json" };
import { classifyGrantAnswer, decideGrant } from "./auth/device-grant.ts";
import { stateOf } from "./lookup.ts";
import { DeletionState, decideDeletion } from "./provision.ts";
import {
  classifyEnvironment,
  classifyTask,
  decideEnvironment,
  decideTask,
} from "./readiness.ts";

const env = Schema.decodeUnknownSync(EnvironmentResponse)(samples.environment);
const busy = { ...env, blocking_tasks_in_progress: true };
const maintenance = { ...env, maintenance_mode: true };

const task = (status: string) => ({
  job_name: `job-${status}`,
  status,
  status_message: status === "FAILED" ? "Out of capacity" : null,
});

describe("store state", () => {
  it.each([
    ["maintenance", maintenance, true],
    ["busy", busy, true],
    ["running", env, undefined],
    ["ready", env, true],
    ["starting", env, false],
  ] as const)("is %s", (state, seen, answered) => {
    expect(stateOf(seen, answered)).toBe(state);
  });
});

describe("Cloud task", () => {
  it.each([
    ["Succeeded", "SUCCEEDED", "Done"],
    ["Running", "PENDING", "Wait"],
    ["Running", "STARTED", "Wait"],
    ["Failed", "FAILED", "Fail"],
    ["Failed", "TIMED_OUT", "Fail"],
  ] as const)("is %s for %s, so the step is %s", (tag, status, step) => {
    const state = classifyTask(task(status));

    expect(state._tag).toBe(tag);
    expect(decideTask("Environment setup", "job")(state)._tag).toBe(step);
  });

  it("names a timed-out task in its failure", () => {
    const step = decideTask("Backup", "job")(classifyTask(task("TIMED_OUT")));

    expect(step).toMatchObject({
      failure: {
        code: "TASK_FAILED",
        message: "Backup timed out in Saleor Cloud.",
      },
    });
  });
});

describe("new environment", () => {
  const classify = (seen: {
    readonly tasks?: readonly ReturnType<typeof task>[];
    readonly found?: typeof env | undefined;
    readonly answers?: boolean;
  }) =>
    classifyEnvironment({
      answers: seen.answers ?? false,
      env: Option.fromUndefinedOr(seen.found),
      envKey: env.key,
      tasks: seen.tasks ?? [],
    });

  it.each([
    ["TaskFailed", { tasks: [task("STARTED"), task("FAILED")], found: env }],
    ["TasksRunning", { tasks: [task("STARTED")], found: env }],
    ["Gone", { found: undefined }],
    ["Busy", { found: busy }],
    ["Busy", { found: maintenance }],
    ["Starting", { found: env, answers: false }],
    ["Ready", { found: env, answers: true }],
  ] as const)("is %s", (tag, seen) => {
    expect(classify(seen)._tag).toBe(tag);
  });

  const decide = decideEnvironment(() => Effect.void);

  it("waits for running tasks before looking at the environment", () => {
    expect(decide(classify({ tasks: [task("STARTED")] }))._tag).toBe("Act");
  });

  it("is done with the environment once its API answers", () => {
    const step = decide(classify({ found: env, answers: true }));

    expect(step._tag).toBe("Done");
    expect(step).toMatchObject({ value: env });
  });

  it("says once where it waits for the API", () => {
    expect(decide(classify({ found: env }))).toMatchObject({
      say: `Waiting for the GraphQL API to respond at https://${env.domain}/graphql/…`,
    });
  });

  it("fails when the environment was deleted meanwhile", () => {
    expect(decide(classify({}))).toMatchObject({
      failure: { code: "NOT_FOUND" },
    });
  });
});

describe("environment deletion", () => {
  it("is done when accepted or gone, and waits while Cloud is busy", () => {
    expect(
      decideDeletion(DeletionState.Accepted({ envKey: env.key }))
    ).toMatchObject({ value: true });
    expect(
      decideDeletion(DeletionState.Gone({ envKey: env.key }))
    ).toMatchObject({ value: false });
    expect(
      decideDeletion(
        DeletionState.Busy({ failure: fail("NOT_READY", "Busy.") })
      )._tag
    ).toBe("Wait");
  });
});

describe("device grant", () => {
  const tokens = {
    access_token: "access",
    expires_in: 300,
    refresh_token: "refresh",
  };

  it.each([
    ["Approved", 200, tokens],
    ["Rejected", 200, { unexpected: true }],
    ["Pending", 400, { error: "authorization_pending" }],
    ["SlowDown", 400, { error: "slow_down" }],
    ["Denied", 400, { error: "access_denied" }],
    ["Expired", 400, { error: "expired_token" }],
    ["Rejected", 400, { error: "invalid_client" }],
    ["Rejected", 500, {}],
  ] as const)("is %s for HTTP %s %j", (tag, status, body) => {
    expect(classifyGrantAnswer(status, body)._tag).toBe(tag);
  });

  it("slows down by five seconds when asked to", () => {
    const step = decideGrant(classifyGrantAnswer(400, { error: "slow_down" }));

    expect(step._tag).toBe("Wait");
    expect(step).toMatchObject({ slowDownBy: { value: { millis: 5000 } } });
  });

  it.each([
    [{ error: "access_denied" }, "AUTH_DEVICE_ACCESS_DENIED"],
    [{ error: "expired_token" }, "AUTH_DEVICE_CODE_EXPIRED"],
    [
      { error: "invalid_client", error_description: "Unknown client" },
      "API_ERROR",
    ],
  ] as const)("fails for %j with %s", (body, code) => {
    expect(decideGrant(classifyGrantAnswer(400, body))).toMatchObject({
      failure: { code },
    });
  });

  it("keeps the server's description of a refused poll", () => {
    expect(
      decideGrant(
        classifyGrantAnswer(400, {
          error: "invalid_client",
          error_description: "Unknown client",
        })
      )
    ).toMatchObject({ failure: { message: "Login failed: Unknown client." } });
  });
});
