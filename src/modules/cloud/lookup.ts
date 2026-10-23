import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import { type InstanceState, instance } from "../../core/target.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  type EnvironmentResponse,
  type ListProjectResponse,
  listEnvironments as listEnvironmentsOperation,
  listListProjects,
  listOrganizations as listOrganizationsOperation,
} from "./api/contract.ts";

export type Project = ListProjectResponse;

export type Environment = EnvironmentResponse;

// Only sandboxes are created, reused or deleted by this CLI. This is an allowlist: a
// service type the CLI does not know yet is treated like production.
export const isSandbox = (env: Environment) =>
  env.service.service_type === "SANDBOX";

// "sandbox", "production", …; for messages.
export const serviceTypeLabel = (env: Environment) =>
  env.service.service_type?.toLowerCase() ?? "non-sandbox";

export const graphqlUrlOf = (env: Environment) =>
  `https://${env.domain}/graphql/`;

// ── Connection details ───────────────────────────────────────────────────

// Without `apiAnswered` only what Cloud reports is known: a task running ("busy"),
// maintenance, or neither ("running"). With it, the store itself was asked.
const stateOf = (env: Environment, apiAnswered?: boolean): InstanceState => {
  if (env.maintenance_mode) {
    return "maintenance";
  }

  if (env.blocking_tasks_in_progress) {
    return "busy";
  }

  if (apiAnswered === undefined) {
    return "running";
  }

  return apiAnswered ? "ready" : "starting";
};

export const describeEnvironment = (
  organization: string,
  env: Environment,
  apiAnswered?: boolean
) => ({
  ...instance({
    dashboardUrl: `https://${env.domain}/dashboard/`,
    graphqlUrl: graphqlUrlOf(env),
    kind: "cloud",
    name: env.name,
    ref: `cloud:${organization}/${env.key}`,
    saleorVersion: env.service.version ?? null,
    state: stateOf(env, apiAnswered),
  }),
  domain: env.domain,
  domainLabel: env.domain_label,
  key: env.key,
  organization,
  project: env.project.slug,
  region: env.service.region,
  serviceType: env.service.service_type?.toLowerCase() ?? null,
});

export type EnvironmentDetails = ReturnType<typeof describeEnvironment>;

export const describePricing = (
  value: Readonly<Record<string, string>> | undefined
) =>
  value === undefined
    ? null
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          item,
        ])
      );

export const describeProject = (organization: string, project: Project) => ({
  name: project.name,
  organization,
  plan: project.plan.slug,
  planType: project.plan.type ?? null,
  pricing: describePricing(project.plan.pricing),
  region: project.region,
  sandboxes: project.sandboxes?.count ?? null,
  slug: project.slug,
});

// ── Lookups ──────────────────────────────────────────────────────────────

export const listOrganizations = Effect.gen(function* () {
  const api = yield* CloudApi;

  return yield* orDescribe(api.call(listOrganizationsOperation));
});

export const listProjects = (organization: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    return yield* orDescribe(
      api.call(listListProjects, {
        path: { organization_slug: organization },
      })
    );
  });

// A ref is a slug or key first; a name only when no slug/key matches and the name is
// unambiguous.
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
      fail(
        "NAME_CONFLICT",
        `More than one ${kind} is named "${ref}": ${matches.map(key).join(", ")}.`,
        {
          details: { matches: matches.map(key) },
          suggestion: `Use the ${kind === "project" ? "project slug" : "environment key"} instead of the name.`,
        }
      )
    );
  }

  return Effect.succeed(Option.fromUndefinedOr(matches[0]));
};

export const findProject = (organization: string, ref: string) =>
  Effect.flatMap(listProjects(organization), (projects) =>
    uniqueMatch(projects, ref, (p) => p.slug, "project")
  );

export const requireProject = (organization: string, ref: string) =>
  Effect.flatMap(findProject(organization, ref), (project) =>
    Option.match(project, {
      onNone: () =>
        fail(
          "NOT_FOUND",
          `Project "${ref}" does not exist in organization "${organization}".`,
          {
            suggestion: `See existing projects with: saleor project list --org ${organization}\nOr create it with: saleor project create ${ref} --org ${organization}`,
          }
        ),
      onSome: Effect.succeed,
    })
  );

// Validates an optional project selection and returns its slug, for commands that
// narrow by project but do not require one.
export const projectSlugOf = (
  organization: string,
  ref: Option.Option<string>
) =>
  Effect.gen(function* () {
    if (Option.isNone(ref)) {
      return;
    }

    return (yield* requireProject(organization, ref.value)).slug;
  });

export const listEnvironments = (organization: string, projectSlug?: string) =>
  Effect.gen(function* () {
    const api = yield* CloudApi;

    const envs = yield* orDescribe(
      api.call(listEnvironmentsOperation, {
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

export const requireEnvironment = (
  organization: string,
  ref: string,
  projectSlug?: string
) =>
  Effect.flatMap(findEnvironment(organization, ref, projectSlug), (env) =>
    Option.match(env, {
      onNone: () =>
        fail(
          "NOT_FOUND",
          projectSlug === undefined
            ? `Environment "${ref}" does not exist in organization "${organization}".`
            : `Environment "${ref}" does not exist in project "${projectSlug}".`,
          {
            suggestion: `List environments with: saleor env list --org ${organization}${projectSlug === undefined ? "" : ` --project ${projectSlug}`}`,
          }
        ),
      onSome: Effect.succeed,
    })
  );

// For commands that need a project: a missing one lists the choices, like a missing
// organization does.
export const requireProjectRef = (
  organization: string,
  ref: Option.Option<string>
) =>
  Effect.gen(function* () {
    if (Option.isSome(ref)) {
      return yield* requireProject(organization, ref.value);
    }

    const slugs = (yield* listProjects(organization)).map((p) => p.slug);

    return yield* fail("CONTEXT_MISSING", "No project selected.", {
      details: { projects: slugs },
      suggestion:
        slugs.length > 0
          ? `Pass --project <project> or set SALEOR_PROJECT. Projects in ${organization}: ${slugs.join(", ")}.`
          : `Pass --project <project> or set SALEOR_PROJECT. ${organization} has no projects yet; create one with: saleor project create <name> --org ${organization}`,
    });
  });
