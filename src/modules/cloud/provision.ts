const LIMIT_ERROR = /reach|exceed|maximum|limit/i;
const SANDBOX_ERROR = /limit|sandbox/i;
const DUPLICATE_ERROR = /exist|taken|unique/i;
const DOMAIN_ERROR = /domain/i;

import { Duration, Effect, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { type CliFailure, fail } from "../../core/errors.ts";
import { notice } from "../../core/output.ts";
import {
  type ApiStatusError,
  CloudApi,
  flattenMessages,
  orDescribe,
} from "./api/client.ts";
import {
  createCreateEnvironment,
  createCreateProject,
  destroyEnvironmentTask,
  type EnvironmentResponse,
  type ListProjectResponse,
  listEnvironments as listEnvironmentOperation,
  listEnvironmentTaskLists,
  listListProjects,
  listPlans,
  listProjectServices,
  obtainPreheatedEnvironmentObtainEnvironment,
  retrieveTaskStatus,
} from "./api/generated.ts";

type Project = ListProjectResponse;

type Environment = EnvironmentResponse;

export const DEFAULT_REGION = "us-east-1";
export const DEFAULT_PLAN = "dev";

// ── Connection details ───────────────────────────────────────────────────

export const describeEnvironment = (
  organization: string,
  env: Environment
) => ({
  blockingTasksInProgress: env.blocking_tasks_in_progress ?? false,
  dashboardUrl: `https://${env.domain}/dashboard/`,
  domain: env.domain,
  domainLabel: env.domain_label,
  graphqlUrl: `https://${env.domain}/graphql/`,
  key: env.key,
  maintenanceMode: env.maintenance_mode ?? false,
  name: env.name,
  organization,
  project: env.project.slug,
  region: env.service.region,
  saleorVersion: env.service.version ?? null,
  serviceType: env.service.service_type,
});

export type EnvironmentDetails = ReturnType<typeof describeEnvironment>;

export const describeProject = (organization: string, project: Project) => ({
  name: project.name,
  organization,
  plan: project.plan.slug,
  planType: project.plan.type ?? null,
  pricing: project.plan.pricing ?? null,
  region: project.region,
  sandboxes: project.sandboxes?.count ?? null,
  slug: project.slug,
});

// ── Lookups ──────────────────────────────────────────────────────────────

export const listProjects = (organization: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    return yield* orDescribe(
      api.call(listListProjects, {
        path: { organization_slug: organization },
      })
    );
  });

export const findProject = (organization: string, ref: string) =>
  Effect.flatMap(listProjects(organization), (projects) =>
    uniqueMatch(projects, ref, (p) => p.slug, "project")
  );

const uniqueMatch = <A extends { readonly name: string }>(
  items: readonly A[],
  ref: string,
  key: (item: A) => string,
  kind: string
) => {
  const exact = items.find((item) => key(item) === ref);

  if (exact) {
    return Effect.succeedSome(exact);
  }

  const matches = items.filter((item) => item.name === ref);

  if (matches.length > 1) {
    return Effect.fail(
      fail("NAME_CONFLICT", `More than one ${kind} is named "${ref}".`, {
        details: { matches: matches.map(key) },
        suggestion: "Select a project slug or an environment key explicitly.",
      })
    );
  }

  return Effect.succeed(Option.fromUndefinedOr(matches[0]));
};

export const requireProject = (organization: string, ref: string) =>
  Effect.flatMap(findProject(organization, ref), (project) =>
    Option.match(project, {
      onNone: () =>
        fail(
          "NOT_FOUND",
          `Project "${ref}" does not exist in organization "${organization}".`,
          {
            suggestion: `Create it with \`saleor project create ${ref} --org ${organization}\`.`,
          }
        ),
      onSome: Effect.succeed,
    })
  );

export const listEnvironments = (organization: string, projectSlug?: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const envs = yield* orDescribe(
      api.call(listEnvironmentOperation, {
        path: { organization_slug: organization },
      })
    );

    return projectSlug === undefined
      ? envs
      : envs.filter((env) => env.project.slug === projectSlug);
  });

// Environment names are unique per project; keys are unique everywhere. Accepts either.
export const findEnvironment = (
  organization: string,
  ref: string,
  projectSlug?: string
) =>
  Effect.flatMap(listEnvironments(organization, projectSlug), (envs) =>
    uniqueMatch(envs, ref, (env) => env.key, "environment")
  );

// ── Projects ─────────────────────────────────────────────────────────────

export interface EnsureProjectInput {
  readonly confirmPaidPlan: boolean;
  readonly name: string;
  readonly organization: string;
  readonly plan: Option.Option<string>;
  readonly region: Option.Option<string>;
}

const confirmPlanCost = (plan: Project["plan"], confirmed: boolean) =>
  Effect.gen(function* () {
    if (plan.type !== "dev" && !confirmed) {
      return yield* fail(
        "PAID_PLAN_NOT_CONFIRMED",
        `Plan "${plan.slug}" is paid; nothing was created.`,
        {
          details: {
            plan: plan.slug,
            pricing: plan.pricing ?? null,
            sandboxes: plan.allowance?.sandboxes ?? null,
          },
          suggestion:
            "Review the pricing in `details`, then re-run with --confirm-paid-plan to accept the cost.",
        }
      );
    }

    if (plan.type !== "dev") {
      yield* notice(
        `Paid plan "${plan.slug}" accepted. Published pricing: ${JSON.stringify(plan.pricing ?? {})}. Usage charges may apply.`
      );
    }
  });

export const ensureProject = (input: EnsureProjectInput) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;
    const existing = yield* findProject(input.organization, input.name);

    if (Option.isSome(existing)) {
      const project = existing.value;

      const mismatches = [
        Option.isSome(input.plan) && input.plan.value !== project.plan.slug
          ? `plan is "${project.plan.slug}", not "${input.plan.value}"`
          : undefined,
        Option.isSome(input.region) && input.region.value !== project.region
          ? `region is "${project.region}", not "${input.region.value}"`
          : undefined,
      ].filter((m): m is string => m !== undefined);

      if (mismatches.length > 0) {
        return yield* fail(
          "NAME_CONFLICT",
          `Project "${input.name}" already exists but its ${mismatches.join(" and ")}.`,
          {
            details: { project: describeProject(input.organization, project) },
            suggestion:
              "Use a different name, or drop the conflicting flags to reuse it.",
          }
        );
      }

      return { created: false, project };
    }

    const planSlug = Option.getOrElse(input.plan, () => DEFAULT_PLAN);
    const plans = yield* orDescribe(api.call(listPlans));
    const plan = plans.find((p) => p.slug === planSlug);

    if (plan === undefined) {
      return yield* fail("USAGE_ERROR", `Unknown plan "${planSlug}".`, {
        details: { plans: plans.map((p) => p.slug) },
      });
    }

    yield* confirmPlanCost(plan, input.confirmPaidPlan);

    const created = yield* orDescribe(
      api.call(createCreateProject, {
        body: {
          name: input.name,
          plan: planSlug,
          region: Option.getOrElse(input.region, () => DEFAULT_REGION),
        },
        path: { organization_slug: input.organization },
      })
    );

    const project = yield* Effect.flatMap(
      findProject(input.organization, created.slug),
      (found) =>
        Option.match(found, {
          onNone: () =>
            fail(
              "API_ERROR",
              `Project "${created.slug}" was created but cannot be listed yet.`,
              { retry: true }
            ),
          onSome: Effect.succeed,
        })
    );

    return { created: true, project };
  });

// ── Waiting ──────────────────────────────────────────────────────────────

export interface Deadline {
  readonly at: number;
  readonly resumeCommand: string;
}

export const deadlineIn = (
  seconds: number,
  resumeCommand: string
): Deadline => ({
  at: Date.now() + seconds * 1000,
  resumeCommand,
});

const notReady = (
  deadline: Deadline,
  what: string,
  details: CliFailure["details"]
) =>
  fail("NOT_READY", `${what} is still in progress.`, {
    details,
    retry: true,
    suggestion: `Run \`${deadline.resumeCommand}\` again; it continues from where it stopped.`,
  });

const POLL = Duration.seconds(
  Number(process.env.SALEOR_POLL_INTERVAL_SECONDS ?? 5)
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
        return task;
      }

      if (task.status === "FAILED" || task.status === "TIMED_OUT") {
        return yield* fail(
          "TASK_FAILED",
          `${label} ended with status ${task.status}.`,
          {
            details: { statusMessage: task.status_message ?? null, taskId },
          }
        );
      }

      if (Date.now() >= deadline.at) {
        return yield* notReady(deadline, label, {
          status: task.status,
          taskId,
        });
      }

      yield* Effect.sleep(POLL);
    }
  });

// Tasks the platform is still running on an environment, found from Cloud itself, so a
// re-run after an interruption needs no local record of the task id.
export const activeBlockingTasks = (organization: string, envKey: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const page = yield* orDescribe(
      api.call(listEnvironmentTaskLists, {
        path: { environment_pk: envKey, organization_slug: organization },
        query: { is_blocking: "true", status: "active" },
      })
    );

    return page.results
      .map((task) => task.job_name)
      .filter((name): name is string => name !== undefined);
  });

// A finished task does not mean the store answers yet; cold starts can take minutes.
export const probeGraphql = (graphqlUrl: string) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;

    const request = HttpClientRequest.post(graphqlUrl).pipe(
      HttpClientRequest.bodyJsonUnsafe({ query: "query { shop { name } }" })
    );

    const response = yield* http
      .execute(request)
      .pipe(Effect.timeout(Duration.seconds(15)), Effect.option);

    if (Option.isNone(response) || response.value.status !== 200) {
      return false;
    }

    const body = yield* response.value.json.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            data: Schema.optionalKey(
              Schema.Struct({
                shop: Schema.optionalKey(
                  Schema.NullOr(Schema.Struct({ name: Schema.String }))
                ),
              })
            ),
          })
        )
      ),
      Effect.orElseSucceed(() => ({ data: undefined }))
    );

    return body.data?.shop !== undefined && body.data.shop !== null;
  });

export const waitUntilReady = (
  organization: string,
  envKey: string,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    let announced = false;

    for (;;) {
      for (const taskId of yield* activeBlockingTasks(organization, envKey)) {
        if (!announced) {
          yield* notice(
            `Waiting for Saleor Cloud to finish provisioning (task ${taskId})…`
          );
        }

        announced = true;
        yield* waitForTask(taskId, deadline, "Provisioning");
      }

      const env = yield* Effect.flatMap(
        findEnvironment(organization, envKey),
        (found) =>
          Option.match(found, {
            onNone: () =>
              fail(
                "NOT_FOUND",
                `Environment "${envKey}" disappeared while waiting.`
              ),
            onSome: Effect.succeed,
          })
      );

      const graphqlUrl = `https://${env.domain}/graphql/`;

      if (
        !(env.blocking_tasks_in_progress || env.maintenance_mode) &&
        (yield* probeGraphql(graphqlUrl))
      ) {
        return env;
      }

      if (Date.now() >= deadline.at) {
        return yield* notReady(deadline, "Starting the store", {
          environment: envKey,
          graphqlUrl,
        });
      }

      if (!announced) {
        yield* notice(`Waiting for ${graphqlUrl} to answer…`);
      }

      announced = true;
      yield* Effect.sleep(POLL);
    }
  });

// ── Environments ─────────────────────────────────────────────────────────

export interface EnsureEnvironmentInput {
  readonly deadline: Deadline;
  readonly domainLabel: Option.Option<string>;
  readonly name: string;
  readonly organization: string;
  readonly project: Project;
  readonly service: Option.Option<string>;
}

const pickSandboxService = (
  organization: string,
  project: Project,
  requested: Option.Option<string>
) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const services = yield* orDescribe(
      api.call(listProjectServices, {
        path: { organization_slug: organization, project_slug: project.slug },
      })
    );

    const sandboxes = services
      .filter(
        (s) =>
          s.service_type === "SANDBOX" &&
          !s.maintenance_mode &&
          (Option.isNone(requested) || s.name === requested.value)
      )
      .sort((a, b) => compareVersions(b.version ?? "", a.version ?? ""));

    const [chosen] = sandboxes;

    if (chosen === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `No matching sandbox service is available for project "${project.slug}".`,
        {
          details: { services: services.map((s) => s.name) },
        }
      );
    }

    return chosen.name;
  });

const compareVersions = (a: string, b: string) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
};

// Server-side validation errors arrive as free text; map the ones agents must branch on.
const classifyCreateRejection = (
  error: ApiStatusError,
  domainLabel: string | undefined
): CliFailure | undefined => {
  if (error.status !== 400) {
    return undefined;
  }

  const text = flattenMessages(error.body);

  if (DOMAIN_ERROR.test(text) && DUPLICATE_ERROR.test(text)) {
    return fail(
      "DOMAIN_LABEL_TAKEN",
      `The domain label "${domainLabel}" is already used by another environment.`,
      {
        details: error.body,
        suggestion:
          "Choose a different --domain-label, or omit it to let Saleor Cloud pick one.",
      }
    );
  }

  if (SANDBOX_ERROR.test(text) && LIMIT_ERROR.test(text)) {
    return fail(
      "ENVIRONMENT_LIMIT_REACHED",
      "The project has no free sandbox environment left.",
      {
        details: error.body,
        suggestion:
          "Delete an unused environment (`saleor env delete`) or move to a plan with more sandboxes.",
      }
    );
  }

  return undefined;
};

export const ensureEnvironment = (input: EnsureEnvironmentInput) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const existing = yield* Effect.map(
      listEnvironments(input.organization, input.project.slug),
      (envs) =>
        Option.fromUndefinedOr(envs.find((env) => env.name === input.name))
    );

    if (Option.isSome(existing)) {
      const env = existing.value;

      if (env.service.service_type !== "SANDBOX") {
        return yield* fail(
          "USAGE_ERROR",
          "Only sandbox environments can be created or reused by this command."
        );
      }

      const mismatches = [
        Option.isSome(input.domainLabel) &&
        input.domainLabel.value !== env.domain_label
          ? `domain label is "${env.domain_label}", not "${input.domainLabel.value}"`
          : undefined,
        Option.isSome(input.service) && input.service.value !== env.service.name
          ? `service is "${env.service.name}", not "${input.service.value}"`
          : undefined,
      ].filter((m): m is string => m !== undefined);

      if (mismatches.length > 0) {
        return yield* fail(
          "NAME_CONFLICT",
          `Environment "${input.name}" already exists but its ${mismatches.join(" and ")}.`,
          {
            details: {
              environment: describeEnvironment(input.organization, env),
            },
            suggestion:
              "Use a different name, or drop the conflicting flags to reuse it.",
          }
        );
      }

      const ready = yield* waitUntilReady(
        input.organization,
        env.key,
        input.deadline
      );

      return { created: false, environment: ready };
    }

    const service = yield* pickSandboxService(
      input.organization,
      input.project,
      input.service
    );

    // Without a requested domain label, take a pre-warmed environment from the pool
    // (Saleor Cloud picks the label); otherwise create one with the label asked for.
    const created = Option.isNone(input.domainLabel)
      ? yield* orDescribe(
          api
            .call(obtainPreheatedEnvironmentObtainEnvironment, {
              body: { name: input.name, project: input.project.slug, service },
              path: { organization_slug: input.organization },
            })
            .pipe(
              Effect.catchTag(
                "ApiStatusError",
                (error): Effect.Effect<never, ApiStatusError | CliFailure> => {
                  const known = classifyCreateRejection(error, undefined);

                  return known ? Effect.fail(known) : Effect.fail(error);
                }
              )
            )
        )
      : yield* orDescribe(
          api
            .call(createCreateEnvironment, {
              body: {
                database_population: null,
                domain_label: input.domainLabel.value,
                name: input.name,
                project: input.project.slug,
                service,
              },
              path: { organization_slug: input.organization },
            })
            .pipe(
              Effect.catchTag(
                "ApiStatusError",
                (error): Effect.Effect<never, ApiStatusError | CliFailure> => {
                  const known = classifyCreateRejection(
                    error,
                    Option.getOrUndefined(input.domainLabel)
                  );

                  return known ? Effect.fail(known) : Effect.fail(error);
                }
              )
            )
        );

    yield* notice(
      `Created environment "${input.name}" (${created.key}); waiting until it is ready…`
    );

    if (created.task_id) {
      yield* waitForTask(created.task_id, input.deadline, "Provisioning");
    }

    const ready = yield* waitUntilReady(
      input.organization,
      created.key,
      input.deadline
    );

    return { created: true, environment: ready };
  });

// ── Deletion ─────────────────────────────────────────────────────────────

export const waitUntilGone = (
  organization: string,
  envKey: string,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    for (;;) {
      const env = yield* findEnvironment(organization, envKey);

      if (Option.isNone(env)) {
        return;
      }

      if (Date.now() >= deadline.at) {
        return yield* notReady(deadline, "Deleting the environment", {
          environment: envKey,
        });
      }

      yield* Effect.sleep(POLL);
    }
  });

export const deleteEnvironment = (
  organization: string,
  env: Environment,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;
    yield* api
      .call(destroyEnvironmentTask, {
        path: { id: env.key, organization_slug: organization },
      })
      .pipe(
        Effect.catchTag(
          "ApiStatusError",
          (error): Effect.Effect<void, ApiStatusError | CliFailure> => {
            if (error.status === 404) {
              return Effect.void;
            }

            // The platform refuses while a blocking task (provisioning, backup) still runs.
            if (
              error.status === 400 ||
              error.status === 409 ||
              error.status === 423
            ) {
              return Effect.fail(
                notReady(deadline, "Another task on this environment", {
                  environment: env.key,
                  reason: flattenMessages(error.body),
                })
              );
            }

            return Effect.fail(error);
          }
        ),
        orDescribe
      );
    yield* notice(`Deleting environment "${env.name}" (${env.key})…`);
    yield* waitUntilGone(organization, env.key, deadline);
  });
