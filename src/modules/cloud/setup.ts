import { Effect, Option } from "effect";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Ensured, Planned } from "../../core/action.ts";
import { result } from "../../core/command.ts";
import { option } from "../../core/inputs.ts";
import type { StoreState } from "../../core/store.ts";
import { deadlineIn } from "../../core/readiness.ts";
import { defineSetup } from "../../core/setup.ts";
import { ensureLoggedIn } from "./auth/ensure-login.ts";
import { account, loggedIn } from "./auth/logged-in.ts";
import {
  describeEnvironment,
  type EnvironmentDetails,
  environmentTarget,
  type CloudProject,
  projectChoices,
} from "./lookup.ts";
import {
  applyEnvironment,
  applyProject,
  billingNotice,
  DEFAULT_REGION,
  type EnvironmentInput,
  type EnvironmentPlan,
  planEnvironment,
  planProject,
  type ProjectInput,
  requireSandboxCapacity,
} from "./provision.ts";
import {
  cloudEnvironment,
  cloudProject,
  organizationOf,
  orgInput,
} from "./targets.ts";
import { saleorMcp } from "./mcp.ts";

const stateText: Record<StoreState, string> = {
  busy: "busy: Saleor Cloud is running a task on it (setup, upgrade or deletion)",
  incomplete: "incomplete",
  maintenance: "in maintenance mode",
  ready: "ready: its GraphQL API answers",
  running: "running",
  starting: "starting: its GraphQL API does not answer yet",
  stopped: "stopped",
};

const environmentLines = (env: EnvironmentDetails) => [
  `  State:       ${stateText[env.state]}`,
  `  GraphQL API: ${env.graphqlUrl}`,
  `  Dashboard:   ${env.dashboardUrl}`,
  `  ${[
    env.saleorVersion === null ? undefined : `Saleor ${env.saleorVersion}`,
    env.serviceType,
    env.region,
  ]
    .filter(Boolean)
    .join(" · ")}`,
];

// Sandboxes cannot be told apart by name alone, so a blank answer gets a short random
// suffix; the name is fixed when it is chosen, so the review and any rerun carry it.
const sandboxName = {
  label: "Create a new sandbox environment",
  placeholder: "Leave blank for a random name",
  prompt: "New environment name",
  whenBlank: () => `sandbox-${randomBytes(3).toString("hex")}`,
};

// Ensuring a sandbox: reuse the one with this name or create one, then wait for it.
const environmentPlan = (
  input: EnvironmentInput,
  planned: EnvironmentPlan,
  timeout: number
) => {
  const creating = planned.existing === undefined;

  return {
    action: creating ? "create" : "reuse",
    apply: Effect.map(
      applyEnvironment(input, planned, deadlineIn(timeout)),
      // applyEnvironment returns only once the GraphQL API answered.
      ({ created, environment: ready }) => {
        const details = describeEnvironment(input.organization, ready, true);

        return {
          ...result(
            {
              ...details,
              created,
              sampleDataReady: created && Option.isNone(input.domainLabel),
            },
            environmentLines(details).join("\n")
          ),
          target: environmentTarget(input.organization, ready),
        };
      }
    ),
    details: {
      domainLabel:
        planned.existing?.domain_label ?? Option.getOrNull(input.domainLabel),
      plan: input.project.plan.slug,
      region: input.project.region,
      service: planned.service,
    },
    notice: creating ? billingNotice(input.project) : undefined,
    risk: null,
    state:
      planned.existing === undefined
        ? "absent"
        : describeEnvironment(input.organization, planned.existing).state,
    summary: [
      ["Service", planned.service],
      ["Plan", `${input.project.plan.slug} (${input.project.region})`],
    ],
    target:
      planned.existing === undefined
        ? {
            id: null,
            name: input.name,
            scope: {
              organization: input.organization,
              project: input.project.slug,
            },
            type: "environment",
          }
        : environmentTarget(input.organization, planned.existing),
  } satisfies Planned<unknown, unknown>;
};

const projectInput = cloudProject.input({ creates: true });
const envInput = cloudEnvironment.input({ creates: true });

type EnsuredEnvironment = Ensured<EnvironmentDetails & { created: boolean }>;

const setupLines = ({
  organization,
  projectSlug,
  projectCreated,
  outcome,
}: {
  readonly organization: string;
  readonly projectSlug: string;
  readonly projectCreated: boolean;
  readonly outcome: EnsuredEnvironment;
}) => [
  `  Project:     ${projectSlug} (${projectCreated ? "created" : "already existed"})`,
  outcome.text,
  "",
  "To use it in other commands, set:",
  `  export SALEOR_ORG=${organization} SALEOR_PROJECT=${projectSlug} SALEOR_ENV=${outcome.data.key}`,
];

// `saleor init` in Saleor Cloud: a project and a sandbox in it, each created or
// reused by name, then waited on until the store answers.
export const cloudSetup = defineSetup({
  before: ensureLoggedIn,
  example: {
    command: "saleor init --org acme --project my-store --env dev",
    description: "Create a Cloud project and sandbox",
  },
  hint: "projects and environments in your organization",
  inputs: {
    domainLabel: option.string("domain-label", {
      description:
        "Subdomain for a new environment (<label>.saleor.cloud). Without it, Saleor Cloud picks one and can hand out an already-running environment, which is much faster.",
      metavar: "label",
    }),
    env: envInput,
    org: orgInput,
    project: projectInput,
    region: option.string("region", {
      default: DEFAULT_REGION,
      description: "Region for a new project. Asked for in a terminal.",
      metavar: "region",
    }),
  },
  label: "Saleor Cloud",
  name: "cloud",
  // An environment of a project is a Cloud environment of the same name.
  naming: { input: "env", name: (_project, environment) => environment },
  onboarding: {
    agentTool: saleorMcp,
    first: ["login"],
    hint: "Log in to your Saleor Cloud account",
    label: "Use Saleor Cloud",
    store:
      "Create a sandbox in Saleor Cloud, with a project folder for its configuration and storefront.",
  },
  plan: (input) =>
    Effect.gen(function* () {
      const organization = yield* organizationOf(input.org);

      const projectName = yield* projectInput.resolve(input.project, {
        choices: projectChoices(organization),
        create: {
          initialValue: path.basename(process.cwd()),
          label: "Create a new project",
          prompt: "Project name",
        },
      });

      const projectRequest: ProjectInput = {
        name: projectName,
        organization,
        region: input.region,
      };

      const projectPlanned = yield* planProject(projectRequest);
      const parent = projectPlanned.existing;

      // Without a requested environment this journey creates a new sandbox.
      // Check before asking its name or running any configuration extensions.
      if (parent !== undefined && Option.isNone(input.env)) {
        yield* requireSandboxCapacity(organization, parent);
      }

      const envName = yield* envInput.resolve(input.env, {
        choices: Effect.succeed([]),
        create: sandboxName,
      });

      const envRequest = (inProject: CloudProject): EnvironmentInput => ({
        domainLabel: input.domainLabel,
        name: envName,
        organization,
        project: inProject,
      });

      const projectDetails = {
        action: parent === undefined ? "create" : "reuse",
        name: projectName,
        plan: projectPlanned.plan.slug,
        region: projectPlanned.region,
      };

      const projectLine = [
        "Project",
        `${projectName} — ${parent === undefined ? `create in ${projectPlanned.region} (${projectPlanned.plan.slug} plan)` : "use existing"}`,
      ] as const;

      const finish =
        (projectSlug: string, projectCreated: boolean) =>
        (outcome: EnsuredEnvironment): EnsuredEnvironment => ({
          ...result(
            { ...outcome.data, projectCreated },
            setupLines({
              organization,
              projectSlug,
              projectCreated,
              outcome,
            }).join("\n")
          ),
          target: outcome.target,
        });

      if (parent === undefined) {
        // A new project has no services to plan the environment with until it exists.
        return {
          action: "create",
          apply: Effect.gen(function* () {
            const created = yield* applyProject(projectRequest, projectPlanned);
            const env = envRequest(created.project);

            const ensured = environmentPlan(
              env,
              yield* planEnvironment(env),
              input.timeout
            );

            return finish(
              created.project.slug,
              created.created
            )(yield* ensured.apply);
          }),
          details: { project: projectDetails },
          risk: null,
          state: "absent",
          summary: [projectLine],
          target: {
            id: null,
            name: envName,
            scope: { organization, project: projectName },
            type: "environment",
          },
        } satisfies Planned<unknown, unknown>;
      }

      const env = envRequest(parent);

      const planned = environmentPlan(
        env,
        yield* planEnvironment(env),
        input.timeout
      );

      return {
        ...planned,
        apply: Effect.map(planned.apply, finish(parent.slug, false)),
        details: { ...planned.details, project: projectDetails },
        summary: [projectLine, ...planned.summary],
      };
    }),
  requirement: {
    hint: "you will log in to your Saleor Cloud account first",
    met: loggedIn,
    status: account,
  },
});
