import { Effect, Option } from "effect";
import { type CliFailure, fail } from "../../core/errors.ts";
import { askSelect, isInteractive } from "../../core/interaction.ts";
import { command, recordAnswer, rerunCommand } from "../../core/invocation.ts";
import { notice } from "../../core/output.ts";
import {
  type Deadline,
  heartbeat,
  isPast,
  POLL,
} from "../../core/readiness.ts";
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
  listPlans,
  listProjectServices,
  listRegions,
  obtainPreheatedEnvironmentObtainEnvironment,
} from "./api/contract.ts";
import {
  describeEnvironment,
  describeProject,
  type CloudEnvironment,
  type EnvironmentDetails,
  findCloudEnvironment,
  findCloudProject,
  isSandbox,
  type CloudProject,
  serviceTypeLabel,
} from "./lookup.ts";
import {
  cloudNotReady,
  waitForTask,
  waitUntilGone,
  waitUntilReady,
} from "./readiness.ts";

export const DEFAULT_REGION = "us-east-1";

// New projects use the free plan; a paid plan is chosen in the dashboard.
const DEFAULT_PLAN = "dev";

// Server-side validation errors arrive as free text; these are the ones agents branch on.
const LIMIT_ERROR = /reach|exceed|maximum|limit/i;
const SANDBOX_ERROR = /limit|sandbox/i;
const DUPLICATE_ERROR = /exist|taken|unique/i;
const DOMAIN_ERROR = /domain/i;
const INVALID_ERROR = /invalid/i;

// Cloud refuses deletes with HTTP 400 while a task runs ("There are active tasks in the
// environment/project") or during maintenance ("… Please, try again in a moment").
const BUSY_ERROR = /active tasks|maintenance|try again/i;

type ConflictDetails =
  | { readonly environment: EnvironmentDetails }
  | { readonly project: ReturnType<typeof describeProject> };

// Reuse by name is only safe when every setting the caller asked for matches.
const requireSameSettings = ({
  kind,
  name,
  checks,
  details,
}: {
  readonly kind: string;
  readonly name: string;
  readonly checks: readonly (readonly [
    string,
    Option.Option<string>,
    string,
  ])[];
  readonly details: ConflictDetails;
}) => {
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
              "Choose a different name, or leave out the conflicting flags to reuse it as it is.",
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
    ? cloudNotReady(what, { ...details, reason: flattenMessages(error.body) })
    : Effect.fail(error);

// ── Projects ─────────────────────────────────────────────────────────────

export interface ProjectInput {
  readonly name: string;
  readonly organization: string;
  readonly region: Option.Option<string>;
}

// A new environment in a project that is not on the free plan may be billed, depending
// on the plan. Said once, right before it is created; the CLI does not work out prices.
export const billingNotice = (project: CloudProject) =>
  project.plan.type === "dev"
    ? undefined
    : `Depending on your plan (${project.plan.slug}), you might be charged for this environment.`;

// A new project's region: the flag, a person's choice, or the default.
const regionFor = (requested: Option.Option<string>) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    // Only for a choice and a clearer error than Cloud's own; a failed lookup leaves
    // the check to Cloud.
    const regions = yield* api
      .call(listRegions)
      .pipe(Effect.orElseSucceed(() => []));

    if (Option.isSome(requested)) {
      if (
        regions.length > 0 &&
        !regions.some((r) => r.name === requested.value)
      ) {
        return yield* fail(
          "USAGE_ERROR",
          `There is no "${requested.value}" region. Available regions: ${regions.map((r) => r.name).join(", ")}.`,
          { details: { regions: regions.map((r) => r.name) } }
        );
      }

      return requested.value;
    }

    if (regions.length <= 1 || !(yield* isInteractive)) {
      return DEFAULT_REGION;
    }

    const chosen = yield* askSelect({
      choices: regions.map(({ name, root_domain }) => ({
        hint: root_domain,
        label: name,
        value: name,
      })),
      initialValue: regions.some((r) => r.name === DEFAULT_REGION)
        ? DEFAULT_REGION
        : regions[0]?.name,
      message: "Region",
    });

    yield* recordAnswer({ option: ["--region", chosen] });

    return chosen;
  });

// Read-only: whether the project exists with the requested settings, or what
// creating it would use.
export const planProject = (input: ProjectInput) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;
    const existing = yield* findCloudProject(input.organization, input.name);

    if (Option.isSome(existing)) {
      const project = existing.value;

      yield* requireSameSettings({
        kind: "Project",
        name: input.name,
        checks: [["region", input.region, project.region]],
        details: { project: describeProject(input.organization, project) },
      });

      return { existing: project, plan: project.plan, region: project.region };
    }

    const plans = yield* orDescribe(api.call(listPlans));
    const plan = plans.find((p) => p.slug === DEFAULT_PLAN);

    if (plan === undefined) {
      return yield* fail(
        "API_ERROR",
        `Saleor Cloud does not offer the "${DEFAULT_PLAN}" plan for new projects. Available plans: ${plans.map((p) => p.slug).join(", ")}.`,
        { details: { plans: plans.map((p) => p.slug) } }
      );
    }

    return {
      existing: undefined,
      plan,
      region: yield* regionFor(input.region),
    };
  });

export type ProjectPlan = Effect.Success<ReturnType<typeof planProject>>;

export const applyProject = (input: ProjectInput, planned: ProjectPlan) =>
  Effect.gen(function* () {
    if (planned.existing !== undefined) {
      return { created: false, project: planned.existing };
    }

    const api = yield* CloudApi;

    const created = yield* orDescribe(
      api.call(createCreateProject, {
        body: {
          name: input.name,
          plan: planned.plan.slug,
          region: planned.region,
        },
        path: { organization_slug: input.organization },
      })
    );

    yield* notice(
      `Created project "${input.name}" in ${planned.region} (${planned.plan.slug} plan).`
    );

    const again = yield* rerunCommand();

    // The create response is a smaller shape; read the project back as list returns it.
    const project = yield* Effect.flatMap(
      findCloudProject(input.organization, created.slug),
      Option.match({
        onNone: () =>
          fail(
            "API_ERROR",
            `Project "${created.slug}" was created, but Saleor Cloud does not list it yet.`,
            {
              retry: true,
              suggestion: `Run the same command again in a moment; it reuses the project: ${again}`,
            }
          ),
        onSome: Effect.succeed,
      })
    );

    return { created: true, project };
  });

// ── Environments ─────────────────────────────────────────────────────────

export interface EnvironmentInput {
  readonly domainLabel: Option.Option<string>;
  readonly name: string;
  readonly organization: string;
  readonly project: CloudProject;
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

// The newest sandbox service that is not in maintenance.
const pickSandboxService = (organization: string, project: CloudProject) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const services = yield* orDescribe(
      api.call(listProjectServices, {
        path: { organization_slug: organization, project_slug: project.slug },
      })
    );

    const [chosen] = services
      .filter((s) => s.service_type === "SANDBOX" && !s.maintenance_mode)
      .sort((a, b) => compareVersions(b.version ?? "", a.version ?? ""));

    const details = { services: services.map((s) => s.name) };

    if (chosen === undefined) {
      return yield* fail(
        "UNAVAILABLE",
        `No sandbox service is available for project "${project.slug}" right now.`,
        {
          details,
          suggestion:
            "Saleor Cloud may be updating its services. Try again in a few minutes.",
        }
      );
    }

    return chosen.name;
  });

// Only an explicit cap is a hard limit; included allowance may allow paid overage.
export const requireSandboxCapacity = (
  organization: string,
  project: CloudProject
) => {
  const cap = project.plan.allowance?.sandboxes?.cap;
  const { count } = project.sandboxes;

  if (cap === undefined || cap === null || count === undefined || count < cap) {
    return Effect.void;
  }

  return Effect.fail(
    fail(
      "ENVIRONMENT_LIMIT_REACHED",
      `Project "${project.slug}" already has ${count} of ${cap} sandbox environments allowed on its "${project.plan.slug}" plan. Delete a sandbox before creating another.`,
      {
        details: { count, limit: cap },
        suggestion: `See existing sandboxes with: ${command("env", "list")}. Delete one with: ${command("env", "remove")} cloud:${organization}/<env key> (asks for confirmation).`,
      }
    )
  );
};

const classifyCreateRejection = ({
  error,
  domainLabel,
  organization,
  project,
}: {
  readonly error: ApiStatusError;
  readonly domainLabel: Option.Option<string>;
  readonly organization: string;
  readonly project: CloudProject;
}): Effect.Effect<never, ApiStatusError | CliFailure> => {
  const text = error.status === 400 ? flattenMessages(error.body) : "";

  if (DOMAIN_ERROR.test(text) && INVALID_ERROR.test(text)) {
    return Effect.fail(
      fail(
        "USAGE_ERROR",
        `"${Option.getOrElse(domainLabel, () => "")}" is not a valid domain label.`,
        {
          details: error.body,
          suggestion:
            "Use lowercase letters, digits and hyphens, starting with a letter and not ending with a hyphen. Or leave out --domain-label and Saleor Cloud picks one.",
        }
      )
    );
  }

  if (DOMAIN_ERROR.test(text) && DUPLICATE_ERROR.test(text)) {
    return Effect.fail(
      fail(
        "DOMAIN_LABEL_TAKEN",
        `The domain label "${Option.getOrElse(domainLabel, () => "")}" is already taken.`,
        {
          details: error.body,
          suggestion:
            "Choose a different --domain-label, or leave it out and Saleor Cloud picks one.",
        }
      )
    );
  }

  const allowance = project.plan.allowance?.sandboxes;
  const limit = allowance?.cap ?? allowance?.included ?? undefined;

  if (SANDBOX_ERROR.test(text) && LIMIT_ERROR.test(text)) {
    return Effect.fail(
      fail(
        "ENVIRONMENT_LIMIT_REACHED",
        `Project "${project.slug}" has reached the limit of ${limit === undefined ? "" : `${limit} `}sandbox environments on its "${project.plan.slug}" plan.`,
        {
          details: { body: error.body, limit: limit ?? null },
          suggestion: `List sandboxes with: ${command("env", "list")}. Delete one with: ${command("env", "remove")} cloud:${organization}/<env key> (asks for confirmation).`,
        }
      )
    );
  }

  return Effect.fail(error);
};

// Without a requested domain label, take a pre-warmed environment from the pool (Saleor
// Cloud picks the label); otherwise create one with the label asked for.
const requestEnvironment = (input: EnvironmentInput, service: string) =>
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
        classifyCreateRejection({
          error,
          domainLabel: input.domainLabel,
          organization: input.organization,
          project: input.project,
        })
      ),
      orDescribe
    );
  });

// Read-only: the sandbox to reuse, or the service a new one would run.
export const planEnvironment = (input: EnvironmentInput) =>
  Effect.gen(function* () {
    // `--env` and the picker give a name or a key; both find the same environment.
    const existing = Option.getOrUndefined(
      yield* findCloudEnvironment(
        input.organization,
        input.name,
        input.project.slug
      )
    );

    if (existing !== undefined) {
      if (!isSandbox(existing)) {
        return yield* fail(
          "NAME_CONFLICT",
          `Environment "${input.name}" already exists and is a ${serviceTypeLabel(existing)} environment, not a sandbox. The CLI only creates and reuses sandboxes.`,
          { suggestion: "Choose a different name." }
        );
      }

      yield* requireSameSettings({
        kind: "Environment",
        name: input.name,
        checks: [["domain label", input.domainLabel, existing.domain_label]],
        details: {
          environment: describeEnvironment(input.organization, existing),
        },
      });

      return { existing, service: existing.service.name };
    }

    yield* requireSandboxCapacity(input.organization, input.project);

    const service = yield* pickSandboxService(
      input.organization,
      input.project
    );

    return { existing: undefined, service };
  });

export type EnvironmentPlan = Effect.Success<
  ReturnType<typeof planEnvironment>
>;

// Creates the planned sandbox, if it does not exist, and waits until it answers.
export const applyEnvironment = (
  input: EnvironmentInput,
  planned: EnvironmentPlan,
  deadline: Deadline
) =>
  Effect.gen(function* () {
    if (planned.existing !== undefined) {
      const ready = yield* waitUntilReady({
        organization: input.organization,
        envKey: planned.existing.key,
        deadline,
      });

      return { created: false, environment: ready };
    }

    const created = yield* requestEnvironment(input, planned.service);

    yield* notice(
      `Setting up environment "${input.name}" (${created.key}). This may take a few minutes…`
    );

    // One heartbeat for the whole wait, however many tasks it spans.
    const beat = heartbeat();

    if (created.task_id) {
      yield* waitForTask({
        taskId: created.task_id,
        deadline,
        label: "Environment setup",
        beat,
      });
    }

    const ready = yield* waitUntilReady({
      organization: input.organization,
      envKey: created.key,
      deadline,
      beat,
    });

    return { created: true, environment: ready };
  });

// Deletion is asynchronous in Cloud (HTTP 202); this waits until the environment is
// no longer listed, or returns NOT_READY so a re-run continues the wait. While another
// task runs (including a deletion an earlier run started), Cloud refuses the request;
// that is waited out within the same budget.
export const deleteEnvironment = (
  organization: string,
  env: CloudEnvironment,
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
                : busyRejection(
                    error,
                    "Saleor Cloud is busy with another task on this environment.",
                    {
                      environment: env.key,
                    }
                  ).pipe(
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

      if (Option.isNone(yield* findCloudEnvironment(organization, env.key))) {
        return;
      }

      yield* Effect.sleep(POLL);
    }

    yield* notice(`Deleting environment "${env.name}" (${env.key})…`);
    yield* waitUntilGone(organization, env.key, deadline);
  });
