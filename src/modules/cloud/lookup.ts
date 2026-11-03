import { Effect, Option } from "effect";
import type { TargetRef } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { type StoreState, storeFrom } from "../../core/store.ts";
import type { Choice } from "../../core/interaction.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import {
  type EnvironmentResponse,
  type ListProjectResponse,
  listEnvironments as listEnvironmentsOperation,
  listListProjects,
  listOrganizations as listOrganizationsOperation,
} from "./api/contract.ts";
import { cloudRef } from "../../core/ref.ts";

export type CloudProject = ListProjectResponse;

export type CloudEnvironment = EnvironmentResponse;

// Only sandboxes are created, reused or deleted by this CLI. This is an allowlist: a
// service type the CLI does not know yet is treated like production.
export const isSandbox = (env: CloudEnvironment) =>
  env.service.service_type === "SANDBOX";

// "sandbox", "production", …; for messages.
export const serviceTypeLabel = (env: CloudEnvironment) =>
  env.service.service_type?.toLowerCase() ?? "non-sandbox";

export const graphqlUrlOf = (env: CloudEnvironment) =>
  `https://${env.domain}/graphql/`;

// ── Connection details ───────────────────────────────────────────────────

// Without `apiAnswered` only what Cloud reports is known: a task running ("busy"),
// maintenance, or neither ("running"). With it, the store itself was asked.
const stateOf = (env: CloudEnvironment, apiAnswered?: boolean): StoreState => {
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
  env: CloudEnvironment,
  apiAnswered?: boolean
) => ({
  ...storeFrom({
    dashboardUrl: `https://${env.domain}/dashboard/`,
    graphqlUrl: graphqlUrlOf(env),
    kind: "cloud",
    name: env.name,
    ref: cloudRef(organization, env.key),
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

export const describeProject = (
  organization: string,
  project: CloudProject
) => ({
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

export const listCloudProjects = (organization: string) =>
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
const uniqueMatch = <A extends { readonly name: string }>({
  items,
  ref,
  key,
  kind,
}: {
  readonly items: readonly A[];
  readonly ref: string;
  readonly key: (item: A) => string;
  readonly kind: string;
}) => {
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

export const findCloudProject = (organization: string, ref: string) =>
  Effect.flatMap(listCloudProjects(organization), (projects) =>
    uniqueMatch({
      items: projects,
      ref,
      key: (p) => p.slug,
      kind: "project",
    })
  );

export const listCloudEnvironments = (
  organization: string,
  projectSlug?: string
) =>
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
export const findCloudEnvironment = (
  organization: string,
  ref: string,
  projectSlug?: string
) =>
  Effect.flatMap(listCloudEnvironments(organization, projectSlug), (envs) =>
    uniqueMatch({
      items: envs,
      ref,
      key: (env) => env.key,
      kind: "environment",
    })
  );

// ── Targets ──────────────────────────────────────────────────────────────

export const environmentTarget = (
  organization: string,
  env: CloudEnvironment
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
  Effect.map(listCloudProjects(organization), (projects) =>
    projects.map((project): Choice<string> => ({
      hint: `${project.slug} · ${project.region} · ${project.plan.slug}`,
      label: project.name,
      value: project.slug,
    }))
  );
