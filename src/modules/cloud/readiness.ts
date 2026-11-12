import { Data, Effect, Option } from "effect";
import { act, converge, done, failWith, wait } from "../../core/converge.ts";
import { type CliFailure, fail } from "../../core/errors.ts";
import { notice } from "../../core/output.ts";
import { type Deadline, heartbeat, notReady } from "../../core/readiness.ts";
import { storeAnswers } from "../../core/store-api.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  listEnvironmentTaskLists,
  retrieveTaskStatus,
} from "./api/contract.ts";
import {
  type CloudEnvironment,
  findCloudEnvironment,
  graphqlUrlOf,
} from "./lookup.ts";

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

// Cloud work carries on in Saleor Cloud after the CLI stops waiting.
export const cloudNotReady = (
  message: string,
  details: Parameters<typeof notReady>[1]
) => notReady(message, details, "Saleor Cloud");

// A Cloud task, as its status reads: still running, done, or failed.
export type TaskState = Data.TaggedEnum<{
  Failed: { readonly task: TaskStatus };
  Running: { readonly task: TaskStatus };
  Succeeded: { readonly task: TaskStatus };
}>;

interface TaskStatus {
  readonly status: string;
  readonly status_message?: string | null;
}

export const TaskState = Data.taggedEnum<TaskState>();

export const classifyTask = (task: TaskStatus): TaskState => {
  if (task.status === "SUCCEEDED") {
    return TaskState.Succeeded({ task });
  }

  return isFailedStatus(task.status)
    ? TaskState.Failed({ task })
    : TaskState.Running({ task });
};

export const decideTask = (label: string, taskId: string) =>
  TaskState.$match({
    Failed: ({ task }) => failWith(taskFailed(label, task, taskId)),
    Running: () => wait(`waiting for ${label.toLowerCase()}`),
    Succeeded: () => done(undefined),
  });

// `beat` is shared by a caller that waits for several tasks in turn, so progress keeps
// showing, and counting, across all of them.
export const waitForTask = ({
  taskId,
  deadline,
  label,
  beat = heartbeat(),
}: {
  readonly taskId: string;
  readonly deadline: Deadline;
  readonly label: string;
  readonly beat?: (what: string) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const status = api
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

    return yield* converge({
      beat,
      deadline,
      decide: decideTask(label, taskId),
      observe: Effect.map(status, classifyTask),
      timeout: (state) =>
        cloudNotReady(`${label.toLowerCase()} is still in progress.`, {
          status: state.task.status,
          taskId,
        }),
    });
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

// How a new environment stands. Blocking tasks come first: a failed one ends the wait,
// running ones are waited for. Then the environment itself: gone, busy or in
// maintenance, up with an API that does not answer yet, or ready.
export type EnvironmentState = Data.TaggedEnum<{
  Busy: { readonly env: CloudEnvironment };
  Gone: { readonly envKey: string };
  Ready: { readonly env: CloudEnvironment };
  Starting: { readonly env: CloudEnvironment };
  TaskFailed: { readonly task: BlockingTask };
  TasksRunning: { readonly tasks: readonly BlockingTask[] };
}>;

type BlockingTask = Effect.Success<ReturnType<typeof blockingTasks>>[number];

export const EnvironmentState = Data.taggedEnum<EnvironmentState>();

export const classifyEnvironment = ({
  envKey,
  tasks,
  env,
  answers,
}: {
  readonly envKey: string;
  readonly tasks: readonly BlockingTask[];
  readonly env: Option.Option<CloudEnvironment>;
  readonly answers: boolean;
}): EnvironmentState => {
  const failed = tasks.find((task) => isFailedStatus(task.status));

  if (failed !== undefined) {
    return EnvironmentState.TaskFailed({ task: failed });
  }

  if (tasks.length > 0) {
    return EnvironmentState.TasksRunning({ tasks });
  }

  if (Option.isNone(env)) {
    return EnvironmentState.Gone({ envKey });
  }

  if (env.value.blocking_tasks_in_progress || env.value.maintenance_mode) {
    return EnvironmentState.Busy({ env: env.value });
  }

  return answers
    ? EnvironmentState.Ready({ env: env.value })
    : EnvironmentState.Starting({ env: env.value });
};

const apiWait = (env: CloudEnvironment) =>
  wait("waiting for the GraphQL API", {
    say: `Waiting for the GraphQL API to respond at ${graphqlUrlOf(env)}…`,
  });

export const decideEnvironment = <R>(
  waitForTasks: (
    tasks: readonly BlockingTask[]
  ) => Effect.Effect<void, CliFailure, R>
) =>
  EnvironmentState.$match({
    Busy: ({ env }) => apiWait(env),
    Gone: ({ envKey }) =>
      failWith(
        fail(
          "NOT_FOUND",
          `Environment "${envKey}" was deleted while waiting for it to be ready.`
        )
      ),
    Ready: ({ env }) => done(env),
    Starting: ({ env }) => apiWait(env),
    TaskFailed: ({ task }) =>
      failWith(taskFailed("Environment setup", task, task.job_name)),
    TasksRunning: ({ tasks }) => act(waitForTasks(tasks)),
  });

export const waitUntilReady = ({
  organization,
  envKey,
  deadline,
  beat = heartbeat(),
}: {
  readonly organization: string;
  readonly envKey: string;
  readonly deadline: Deadline;
  readonly beat?: (what: string) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const said = { setup: false };

    const observe = Effect.gen(function* () {
      const tasks = yield* blockingTasks(organization, envKey);

      if (tasks.length > 0) {
        return classifyEnvironment({
          answers: false,
          env: Option.none(),
          envKey,
          tasks,
        });
      }

      const env = yield* findCloudEnvironment(organization, envKey);

      const answers =
        Option.isSome(env) &&
        !(env.value.blocking_tasks_in_progress || env.value.maintenance_mode) &&
        (yield* storeAnswers(graphqlUrlOf(env.value)));

      return classifyEnvironment({ answers, env, envKey, tasks });
    });

    const waitForTasks = (tasks: readonly BlockingTask[]) =>
      Effect.gen(function* () {
        if (!said.setup) {
          said.setup = true;
          yield* notice(
            "Waiting for Saleor Cloud to finish setting up the environment…"
          );
        }

        for (const task of tasks) {
          yield* waitForTask({
            taskId: task.job_name,
            deadline,
            label: "Environment setup",
            beat,
          });
        }
      });

    return yield* converge({
      beat,
      deadline,
      decide: decideEnvironment(waitForTasks),
      observe,
      timeout: (state) =>
        cloudNotReady(
          "the environment is set up, but its GraphQL API is not responding yet.",
          {
            environment: envKey,
            graphqlUrl:
              EnvironmentState.$is("Starting")(state) ||
              EnvironmentState.$is("Busy")(state)
                ? graphqlUrlOf(state.env)
                : null,
          }
        ),
    });
  });

export const waitUntilGone = (
  organization: string,
  envKey: string,
  deadline: Deadline
) =>
  converge({
    deadline,
    decide: (env: Option.Option<CloudEnvironment>) =>
      Option.isNone(env) ? done(undefined) : wait("deleting"),
    observe: findCloudEnvironment(organization, envKey),
    timeout: () =>
      cloudNotReady("the environment is still being deleted.", {
        environment: envKey,
      }),
  });
