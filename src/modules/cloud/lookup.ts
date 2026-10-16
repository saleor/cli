import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  type EnvironmentResponse,
  type ListProjectResponse,
  listEnvironments as listEnvironmentsOperation,
  listListProjects,
  listOrganizations as listOrganizationsOperation,
} from "./api/generated.ts";

export type Project = ListProjectResponse;

export type Environment = EnvironmentResponse;

// Only sandboxes are created, reused or deleted by this CLI. This is an allowlist: a
// service type the CLI does not know yet is treated like production.
export const isSandbox = (env: Environment) =>
  env.service.service_type === "SANDBOX";

export const graphqlUrlOf = (env: Environment) =>
  `https://${env.domain}/graphql/`;

// ── Connection details ───────────────────────────────────────────────────

export const describeEnvironment = (
  organization: string,
  env: Environment
) => ({
  blockingTasksInProgress: env.blocking_tasks_in_progress ?? false,
  dashboardUrl: `https://${env.domain}/dashboard/`,
  domain: env.domain,
  domainLabel: env.domain_label,
  graphqlUrl: graphqlUrlOf(env),
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
      fail("NAME_CONFLICT", `More than one ${kind} is named "${ref}".`, {
        details: { matches: matches.map(key) },
        suggestion: "Select a project slug or an environment key explicitly.",
      })
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
            suggestion: `Create it with \`saleor project create ${ref} --org ${organization}\`.`,
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
          `Environment "${ref}" does not exist in organization "${organization}".`,
          { suggestion: "List them with `saleor env list`." }
        ),
      onSome: Effect.succeed,
    })
  );
