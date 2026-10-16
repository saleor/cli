import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import { notice } from "../../core/output.ts";
import {
  type Deadline,
  isPast,
  notReady,
  POLL,
  probeGraphql,
} from "../../core/readiness.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  listEnvironmentTaskLists,
  retrieveTaskStatus,
} from "./api/generated.ts";
import { type Environment, findEnvironment, graphqlUrlOf } from "./lookup.ts";

const isFailedStatus = (status: string) =>
  status === "FAILED" || status === "TIMED_OUT";

const taskFailed = (
  label: string,
  task: { readonly status: string; readonly status_message?: string | null },
  taskId: string
) =>
  fail(
    "TASK_FAILED",
    `${label} ${task.status === "TIMED_OUT" ? "timed out" : "failed"} in Saleor Cloud${task.status_message ? `: ${task.status_message}` : "."}`,
    {
      details: { statusMessage: task.status_message ?? null, taskId },
    }
  );

export const waitForTask = (
  taskId: string,
  deadline: Deadline,
  label: string
) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    for (;;) {
      const task = yield* api
        .call(retrieveTaskStatus, { path: { job_name: taskId } })
        .pipe(
          // A task that was just queued may not be visible yet.
          Effect.catchTag("ApiStatusError", (error) =>
            error.status === 404
              ? Effect.succeed({
                  status: "PENDING" as const,
                  status_message: null,
                })
              : Effect.fail(error)
          ),
          orDescribe
        );

      if (task.status === "SUCCEEDED") {
        return;
      }

      if (isFailedStatus(task.status)) {
        return yield* taskFailed(label, task, taskId);
      }

      if (isPast(deadline)) {
        return yield* notReady(`${label.toLowerCase()} is still in progress.`, {
          status: task.status,
          taskId,
        });
      }

      yield* Effect.sleep(POLL);
    }
  });

// Cloud's `is_blocking` task filter returns the blocking tasks still running on an
// environment *and* its failed creation, if any. That is found from Cloud itself, so a
// re-run after an interruption needs no local record of the task id, and a creation
// that failed while nobody was watching is reported instead of waited on.
export const blockingTasks = (organization: string, envKey: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const page = yield* orDescribe(
      api.call(listEnvironmentTaskLists, {
        path: { environment_pk: envKey, organization_slug: organization },
        query: { is_blocking: "true" },
      })
    );

    return page.results;
  });

// Prints each progress message once per run, on stderr.
const progress = () => {
  const shown = new Set<string>();

  return (message: string) =>
    shown.has(message)
      ? Effect.void
      : Effect.andThen(
          Effect.sync(() => shown.add(message)),
          notice(message)
        );
};

export const waitUntilReady = (
  organization: string,
  envKey: string,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    const say = progress();

    for (;;) {
      const tasks = yield* blockingTasks(organization, envKey);
      const failed = tasks.find((task) => isFailedStatus(task.status));

      if (failed !== undefined) {
        return yield* taskFailed("Environment setup", failed, failed.job_name);
      }

      for (const task of tasks) {
        yield* say(
          "Waiting for Saleor Cloud to finish setting up the environment…"
        );
        yield* waitForTask(task.job_name, deadline, "Environment setup");
      }

      const found = yield* findEnvironment(organization, envKey);

      if (Option.isNone(found)) {
        return yield* fail(
          "NOT_FOUND",
          `Environment "${envKey}" was deleted while waiting for it to be ready.`
        );
      }

      const env: Environment = found.value;
      const graphqlUrl = graphqlUrlOf(env);

      if (
        !(env.blocking_tasks_in_progress || env.maintenance_mode) &&
        (yield* probeGraphql(graphqlUrl))
      ) {
        return env;
      }

      if (isPast(deadline)) {
        return yield* notReady(
          "the environment is set up, but its GraphQL API is not responding yet.",
          {
            environment: envKey,
            graphqlUrl,
          }
        );
      }

      yield* say(`Waiting for the GraphQL API to respond at ${graphqlUrl}…`);
      yield* Effect.sleep(POLL);
    }
  });

export const waitUntilGone = (
  organization: string,
  envKey: string,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    for (;;) {
      if (Option.isNone(yield* findEnvironment(organization, envKey))) {
        return;
      }

      if (isPast(deadline)) {
        return yield* notReady("the environment is still being deleted.", {
          environment: envKey,
        });
      }

      yield* Effect.sleep(POLL);
    }
  });
