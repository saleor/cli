import { Effect, Option } from "effect";
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
  destroyProject,
  listPlans,
  listProjectServices,
  obtainPreheatedEnvironmentObtainEnvironment,
} from "./api/generated.ts";
import {
  describeEnvironment,
  describeProject,
  type Environment,
  type EnvironmentDetails,
  findEnvironment,
  findProject,
  isSandbox,
  listEnvironments,
  type Project,
} from "./lookup.ts";
import {
  type Deadline,
  isPast,
  notReady,
  POLL,
  waitForTask,
  waitUntilGone,
  waitUntilReady,
} from "./readiness.ts";

export const DEFAULT_REGION = "us-east-1";
export const DEFAULT_PLAN = "dev";

// Server-side validation errors arrive as free text; these are the ones agents branch on.
const LIMIT_ERROR = /reach|exceed|maximum|limit/i;
const SANDBOX_ERROR = /limit|sandbox/i;
const DUPLICATE_ERROR = /exist|taken|unique/i;
const DOMAIN_ERROR = /domain/i;

// Cloud refuses deletes with HTTP 400 while a task runs ("There are active tasks in the
// environment/project") or during maintenance ("… Please, try again in a moment").
const BUSY_ERROR = /active tasks|maintenance|try again/i;

type ConflictDetails =
  | { readonly environment: EnvironmentDetails }
  | { readonly project: ReturnType<typeof describeProject> };

// Reuse by name is only safe when every setting the caller asked for matches.
const requireSameSettings = (
  kind: string,
  name: string,
  checks: ReadonlyArray<readonly [string, Option.Option<string>, string]>,
  details: ConflictDetails
) => {
  const mismatches = checks.flatMap(([label, wanted, actual]) =>
    Option.isSome(wanted) && wanted.value !== actual
      ? [`${label} is "${actual}", not "${wanted.value}"`]
      : []
  );

  return mismatches.length === 0
    ? Effect.void
    : Effect.fail(
        fail(
          "NAME_CONFLICT",
          `${kind} "${name}" already exists but its ${mismatches.join(" and ")}.`,
          {
            details,
            suggestion:
              "Use a different name, or drop the conflicting flags to reuse it.",
          }
        )
      );
};

const busyRejection = (
  error: ApiStatusError,
  what: string,
  details: Readonly<Record<string, string>>
): Effect.Effect<never, ApiStatusError | CliFailure> =>
  error.status === 400 && BUSY_ERROR.test(flattenMessages(error.body))
    ? notReady(what, { ...details, reason: flattenMessages(error.body) })
    : Effect.fail(error);

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
    if (plan.type === "dev") {
      return;
    }

    if (!confirmed) {
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

    yield* notice(
      `Paid plan "${plan.slug}" accepted. Published pricing: ${JSON.stringify(plan.pricing ?? {})}. Usage charges may apply.`
    );
  });

export const ensureProject = (input: EnsureProjectInput) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;
    const existing = yield* findProject(input.organization, input.name);

    if (Option.isSome(existing)) {
      const project = existing.value;

      yield* requireSameSettings(
        "Project",
        input.name,
        [
          ["plan", input.plan, project.plan.slug],
          ["region", input.region, project.region],
        ],
        { project: describeProject(input.organization, project) }
      );

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

    // The create response is a smaller shape; read the project back as list returns it.
    const project = yield* Effect.flatMap(
      findProject(input.organization, created.slug),
      Option.match({
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

// Cloud itself would delete a project's environments with it; this CLI refuses instead,
// so deleting a project can never take a store with it.
export const requireEmptyProject = (organization: string, project: Project) =>
  Effect.gen(function* () {
    const environments = yield* listEnvironments(organization, project.slug);

    if (environments.length > 0) {
      return yield* fail(
        "PROJECT_NOT_EMPTY",
        `Project "${project.slug}" still has ${environments.length} environment(s).`,
        {
          details: {
            environments: environments.map((env) => ({
              key: env.key,
              name: env.name,
            })),
          },
          suggestion: "Delete its environments first with `saleor env delete`.",
        }
      );
    }
  });

export const deleteProject = (organization: string, project: Project) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    // Checked again right before the write, in case an environment appeared meanwhile.
    yield* requireEmptyProject(organization, project);
    yield* api
      .call(destroyProject, {
        path: { organization_slug: organization, slug: project.slug },
      })
      .pipe(
        Effect.catchTag(
          "ApiStatusError",
          (error): Effect.Effect<void, ApiStatusError | CliFailure> =>
            error.status === 404
              ? Effect.void
              : busyRejection(error, "Another task in this project", {
                  project: project.slug,
                })
        ),
        orDescribe
      );
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

    const [chosen] = services
      .filter(
        (s) =>
          s.service_type === "SANDBOX" &&
          !s.maintenance_mode &&
          (Option.isNone(requested) || s.name === requested.value)
      )
      .sort((a, b) => compareVersions(b.version ?? "", a.version ?? ""));

    if (chosen === undefined) {
      return yield* fail(
        "USAGE_ERROR",
        `No matching sandbox service is available for project "${project.slug}".`,
        { details: { services: services.map((s) => s.name) } }
      );
    }

    return chosen.name;
  });

const classifyCreateRejection = (
  error: ApiStatusError,
  domainLabel: Option.Option<string>
): Effect.Effect<never, ApiStatusError | CliFailure> => {
  const text = error.status === 400 ? flattenMessages(error.body) : "";

  if (DOMAIN_ERROR.test(text) && DUPLICATE_ERROR.test(text)) {
    return Effect.fail(
      fail(
        "DOMAIN_LABEL_TAKEN",
        `The domain label "${Option.getOrElse(domainLabel, () => "")}" is already used by another environment.`,
        {
          details: error.body,
          suggestion:
            "Choose a different --domain-label, or omit it to let Saleor Cloud pick one.",
        }
      )
    );
  }

  if (SANDBOX_ERROR.test(text) && LIMIT_ERROR.test(text)) {
    return Effect.fail(
      fail(
        "ENVIRONMENT_LIMIT_REACHED",
        "The project has no free sandbox environment left.",
        {
          details: error.body,
          suggestion:
            "Delete an unused environment (`saleor env delete`) or move to a plan with more sandboxes.",
        }
      )
    );
  }

  return Effect.fail(error);
};

// Without a requested domain label, take a pre-warmed environment from the pool (Saleor
// Cloud picks the label); otherwise create one with the label asked for.
const requestEnvironment = (input: EnsureEnvironmentInput, service: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;
    const common = { name: input.name, project: input.project.slug, service };
    const path = { organization_slug: input.organization };

    const request = Option.match(input.domainLabel, {
      onNone: () =>
        api.call(obtainPreheatedEnvironmentObtainEnvironment, {
          body: common,
          path,
        }),
      onSome: (domainLabel) =>
        api.call(createCreateEnvironment, {
          body: {
            ...common,
            database_population: null,
            domain_label: domainLabel,
          },
          path,
        }),
    });

    return yield* request.pipe(
      Effect.catchTag("ApiStatusError", (error) =>
        classifyCreateRejection(error, input.domainLabel)
      ),
      orDescribe
    );
  });

export const ensureEnvironment = (input: EnsureEnvironmentInput) =>
  Effect.gen(function* () {
    const envs = yield* listEnvironments(
      input.organization,
      input.project.slug
    );

    const existing = envs.find((env) => env.name === input.name);

    if (existing !== undefined) {
      if (!isSandbox(existing)) {
        return yield* fail(
          "USAGE_ERROR",
          `Environment "${input.name}" is not a sandbox; this command only creates or reuses sandboxes.`
        );
      }

      yield* requireSameSettings(
        "Environment",
        input.name,
        [
          ["domain label", input.domainLabel, existing.domain_label],
          ["service", input.service, existing.service.name],
        ],
        { environment: describeEnvironment(input.organization, existing) }
      );

      const ready = yield* waitUntilReady(
        input.organization,
        existing.key,
        input.deadline
      );

      return { created: false, environment: ready };
    }

    const service = yield* pickSandboxService(
      input.organization,
      input.project,
      input.service
    );

    const created = yield* requestEnvironment(input, service);

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

// Deletion is asynchronous in Cloud (HTTP 202); this waits until the environment is
// no longer listed, or returns NOT_READY so a re-run continues the wait. While another
// task runs (including a deletion an earlier run started), Cloud refuses the request;
// that is waited out within the same budget.
export const deleteEnvironment = (
  organization: string,
  env: Environment,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    for (;;) {
      const accepted = yield* api
        .call(destroyEnvironmentTask, {
          path: { id: env.key, organization_slug: organization },
        })
        .pipe(
          Effect.as(true),
          Effect.catchTag(
            "ApiStatusError",
            (error): Effect.Effect<boolean, ApiStatusError | CliFailure> =>
              error.status === 404
                ? Effect.succeed(true)
                : busyRejection(error, "Another task on this environment", {
                    environment: env.key,
                  }).pipe(
                    Effect.catchTag("CliFailure", (busy) =>
                      busy.code === "NOT_READY" && !isPast(deadline)
                        ? Effect.succeed(false)
                        : Effect.fail(busy)
                    )
                  )
          ),
          orDescribe
        );

      if (accepted) {
        break;
      }

      if (Option.isNone(yield* findEnvironment(organization, env.key))) {
        return;
      }

      yield* Effect.sleep(POLL);
    }

    yield* notice(`Deleting environment "${env.name}" (${env.key})…`);
    yield* waitUntilGone(organization, env.key, deadline);
  });
