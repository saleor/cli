import { Effect, Option } from "effect";
import type { TargetRef } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { type InstanceState, instance } from "../../core/instance.ts";
import type { Choice } from "../../core/interaction.ts";
import { command } from "../../core/invocation.ts";
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

export const describeProject = (organization: string, project: Project) => ({
  name: project.name,
  organization,
  plan: project.plan.slug,
  planType: project.plan.type ?? null,
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
        "AMBIGUOUS_TARGET",
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

const requireProject = (organization: string, ref: string) =>
  Effect.flatMap(findProject(organization, ref), (project) =>
    Option.match(project, {
      onNone: () =>
        fail(
          "NOT_FOUND",
          `Project "${ref}" does not exist in organization "${organization}".`,
          {
            suggestion: `See the environments in each project with: ${command("env", "list", "--org", organization)}\nOr create a store in it with: ${command("init", "--org", organization, "--project", ref)}`,
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

// ── Targets ──────────────────────────────────────────────────────────────

export const environmentTarget = (
  organization: string,
  env: Environment
): TargetRef => ({
  id: env.key,
  name: env.name,
  scope: { organization, project: env.project.slug },
  type: "environment",
});

// What a person picks from, when a command needs a target it was not given.
export const organizationChoices = Effect.map(listOrganizations, (orgs) =>
  orgs.map(
    // The slug is what to pass; shown only when the name does not already say it.
    (org): Choice<string> =>
      org.name === org.slug
        ? { label: org.name, value: org.slug }
        : { hint: org.slug, label: org.name, value: org.slug }
  )
);

export const projectChoices = (organization: string) =>
  Effect.map(listProjects(organization), (projects) =>
    projects.map(
      (project): Choice<string> => ({
        hint: `${project.slug} · ${project.region} · ${project.plan.slug}`,
        label: project.name,
        value: project.slug,
      })
    )
  );

export const environmentChoices = (
  organization: string,
  projectSlug: string | undefined,
  only: (env: Environment) => boolean = () => true
) =>
  Effect.map(listEnvironments(organization, projectSlug), (envs) =>
    envs.filter(only).map(
      (env): Choice<string> => ({
        hint: `${env.key} · ${env.project.slug} · ${serviceTypeLabel(env)}`,
        label: env.name,
        value: env.key,
      })
    )
  );
