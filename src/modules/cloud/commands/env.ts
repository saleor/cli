import { Effect, Option } from "effect";
import {
  absent,
  defineGroup,
  listing,
  type Planned,
} from "../../../core/action.ts";
import { fail } from "../../../core/errors.ts";
import { command } from "../../../core/invocation.ts";
import { deadlineIn } from "../../../core/readiness.ts";
import {
  describeEnvironment,
  environmentChoices,
  environmentTarget,
  findEnvironment,
  isSandbox,
  listEnvironments,
  projectSlugOf,
  serviceTypeLabel,
} from "../lookup.ts";
import { deleteEnvironment } from "../provision.ts";
import {
  cloud,
  environment,
  organizationOf,
  orgInput,
  project,
} from "../targets.ts";

// Narrows what is listed or looked up to one project; never asked for.
const projectFilter = project.input({ filter: true });

const envList = cloud.list({
  description:
    "List environments in an organization. Narrowed to one project with --project.",
  examples: [
    {
      command: "saleor env list --org acme --project my-store",
      description: "List the environments of one project",
    },
  ],
  inputs: { org: orgInput, project: projectFilter },
  name: "list",
  run: (input) =>
    Effect.gen(function* () {
      const organization = yield* organizationOf(input.org);

      const projectSlug = yield* projectSlugOf(
        organization,
        yield* projectFilter.optional(input.project)
      );

      return listing(
        (yield* listEnvironments(organization, projectSlug)).map((env) =>
          describeEnvironment(organization, env)
        ),
        [
          ["NAME", (env) => env.name],
          ["KEY", (env) => env.key],
          ["PROJECT", (env) => env.project],
          ["TYPE", (env) => env.serviceType],
          ["STATE", (env) => env.state],
          ["GRAPHQL API", (env) => env.graphqlUrl],
          ["DASHBOARD", (env) => env.dashboardUrl],
        ],
        `No environments in ${[organization, projectSlug].filter(Boolean).join(" / ")}. Create one with: ${command("init", "--org", organization, ...(projectSlug === undefined ? [] : ["--project", projectSlug]))}`
      );
    }),
  summary: "List environments.",
});

const doomedEnv = environment.input({ positional: true });

const envDelete = cloud.remove({
  description:
    "Delete a sandbox environment and all its data. Asks for confirmation unless --force is passed. Never reads the organization, project or environment from SALEOR_* variables. Production environments can only be deleted in the dashboard.",
  examples: [
    {
      command:
        "saleor env delete preview --org acme --project my-store --force",
      description: "Delete the preview sandbox without a question",
    },
  ],
  inputs: { env: doomedEnv, org: orgInput, project: projectFilter },
  name: "delete",
  plan: (input) =>
    Effect.gen(function* () {
      const organization = yield* organizationOf(input.org);

      const projectSlug = yield* projectSlugOf(
        organization,
        yield* projectFilter.optional(input.project)
      );

      const ref = yield* doomedEnv.resolve(input.env, {
        choices: environmentChoices(organization, projectSlug, isSandbox),
      });

      const found = yield* findEnvironment(organization, ref, projectSlug);

      if (Option.isNone(found)) {
        return absent({
          id: null,
          name: ref,
          scope:
            projectSlug === undefined
              ? { organization }
              : { organization, project: projectSlug },
          type: "environment",
        });
      }

      const env = found.value;

      if (!isSandbox(env)) {
        return yield* fail(
          "PRODUCTION_DELETE_REFUSED",
          `"${env.name}" is a ${serviceTypeLabel(env)} environment. The CLI only deletes sandboxes.`,
          {
            suggestion: `To delete it, use the Saleor Cloud dashboard: https://cloud.saleor.io/org/${organization}/environments/${env.key}`,
          }
        );
      }

      const details = describeEnvironment(organization, env);

      return {
        action: "delete",
        apply: Effect.as(
          deleteEnvironment(organization, env, deadlineIn(input.timeout)),
          {}
        ),
        details,
        risk: "All its data is deleted. This cannot be undone.",
        state: details.state,
        target: environmentTarget(organization, env),
      } satisfies Planned<object, unknown>;
    }),
  risk: "Permanently deletes the sandbox and all its data.",
  summary: "Delete a sandbox environment.",
  waits: true,
});

export const envCommand = defineGroup({
  actions: [envList, envDelete],
  description:
    "List and delete Saleor Cloud environments. An environment is one running Saleor instance with its own GraphQL API and dashboard; create one with saleor init.",
  name: "env",
  summary: "List and delete Cloud environments.",
});
