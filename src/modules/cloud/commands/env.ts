import { Config, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import { forceFlag, timeoutFlag } from "../../../core/flags.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { columns } from "../../../core/output.ts";
import { deadlineIn } from "../../../core/readiness.ts";
import { domainLabelDescription } from "../flags.ts";
import {
  describeEnvironment,
  type EnvironmentDetails,
  findEnvironment,
  isSandbox,
  listEnvironments,
  projectSlugOf,
  requireEnvironment,
  requireProject,
  serviceTypeLabel,
} from "../lookup.ts";
import { deleteEnvironment, ensureEnvironment } from "../provision.ts";

import { orgFlag, projectFlag, requireScoped, resolveScope } from "../scope.ts";

export const envText = (env: EnvironmentDetails) =>
  [
    `Environment "${env.name}" (${env.key}) in ${env.organization} / ${env.project}`,
    `  GraphQL API: ${env.graphqlUrl}`,
    `  Dashboard:   ${env.dashboardUrl}`,
    `  ${[
      env.saleorVersion === null ? undefined : `Saleor ${env.saleorVersion}`,
      env.serviceType?.toLowerCase(),
      env.region,
    ]
      .filter(Boolean)
      .join(" · ")}`,
  ].join("\n");

const envList = Command.make(
  "list",
  { org: orgFlag, project: projectFlag },
  (flags) =>
    run(
      Effect.gen(function* () {
        const scope = yield* resolveScope(flags);

        const projectSlug = yield* projectSlugOf(
          scope.organization,
          scope.project
        );

        const envs = (yield* listEnvironments(
          scope.organization,
          projectSlug
        )).map((env) => describeEnvironment(scope.organization, env));

        const where = [scope.organization, projectSlug]
          .filter(Boolean)
          .join(" / ");

        return result(
          envs,
          envs.length === 0
            ? `No environments in ${where}.`
            : columns([
                ["NAME", "KEY", "PROJECT", "TYPE", "GRAPHQL API"],
                ...envs.map((env) => [
                  env.name,
                  env.key,
                  env.project,
                  env.serviceType?.toLowerCase() ?? "",
                  env.graphqlUrl,
                ]),
              ])
        );
      })
    )
).pipe(
  Command.withDescription(
    "List environments in an organization. Narrowed to one project with --project or the directory's linked project."
  ),
  Command.withShortDescription("List environments.")
);

const envGet = Command.make(
  "get",
  {
    env: Argument.String("env").pipe(
      Argument.withDescription(
        "Environment name or key. Defaults to SALEOR_ENV, then the directory's link."
      ),
      Argument.withFallbackConfig(Config.String("SALEOR_ENV")),
      Argument.optional
    ),
    org: orgFlag,
    project: projectFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const scope = yield* resolveScope(flags);
        const ref = yield* requireScoped(scope.environment, "environment");

        const projectSlug = yield* projectSlugOf(
          scope.organization,
          scope.project
        );

        const env = yield* requireEnvironment(
          scope.organization,
          ref,
          projectSlug
        );

        const details = describeEnvironment(scope.organization, env);

        return result(details, envText(details));
      })
    )
).pipe(
  Command.withDescription(
    "Show an environment's GraphQL API and dashboard URLs."
  )
);

const envCreate = Command.make(
  "create",
  {
    domainLabel: Flag.String("domain-label").pipe(
      Flag.withMetavar("label"),
      Flag.withDescription(domainLabelDescription),
      Flag.optional
    ),
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "Name for the environment, unique within the project. If it already exists, it is reused."
      )
    ),
    org: orgFlag,
    project: projectFlag,
    service: Flag.String("service").pipe(
      Flag.withMetavar("name"),
      Flag.withDescription(
        "Saleor Cloud service to run, which sets the Saleor version. Defaults to the newest sandbox service."
      ),
      Flag.optional
    ),
    timeout: timeoutFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const scope = yield* resolveScope(flags);
        const projectRef = yield* requireScoped(scope.project, "project");
        const project = yield* requireProject(scope.organization, projectRef);

        const { environment, created } = yield* ensureEnvironment({
          deadline: deadlineIn(flags.timeout),
          domainLabel: flags.domainLabel,
          name: flags.name,
          organization: scope.organization,
          project,
          service: flags.service,
        });

        const details = describeEnvironment(scope.organization, environment);

        return result(
          { ...details, created, ready: true },
          `${created ? "✓ Created and ready." : "✓ Already exists and is ready."}\n${envText(details)}`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Create a sandbox environment and wait until its GraphQL API responds. If the name already exists, the environment is reused, so re-running after an interruption picks up where it stopped."
  ),
  Command.withShortDescription(
    "Create a sandbox environment and wait until it is ready."
  ),
  Command.withExamples([
    {
      command: "saleor env create dev --org acme --project my-store",
      description: "Create a sandbox named dev in the my-store project",
    },
  ])
);

const envDelete = Command.make(
  "delete",
  {
    env: Argument.String("env").pipe(
      Argument.withDescription("Environment name or key.")
    ),
    force: forceFlag,
    org: orgFlag,
    project: projectFlag,
    timeout: timeoutFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const scope = yield* resolveScope({ org: flags.org });

        // Only an explicit project narrows a delete. Narrowing by the linked project
        // could report an environment elsewhere in the organization as already gone.
        const projectSlug = yield* projectSlugOf(
          scope.organization,
          flags.project
        );

        const found = yield* findEnvironment(
          scope.organization,
          flags.env,
          projectSlug
        );

        if (Option.isNone(found)) {
          return result(
            {
              deleted: false,
              environment: flags.env,
              organization: scope.organization,
            },
            `Environment "${flags.env}" does not exist, so there is nothing to delete.`
          );
        }

        const env = found.value;

        if (!isSandbox(env)) {
          return yield* fail(
            "PRODUCTION_DELETE_REFUSED",
            `"${env.name}" is a ${serviceTypeLabel(env)} environment. The CLI only deletes sandboxes.`,
            {
              suggestion: `To delete it, use the Saleor Cloud dashboard: https://cloud.saleor.io/org/${scope.organization}/environments/${env.key}`,
            }
          );
        }

        yield* confirmDestructive(
          {
            question: `Delete environment "${env.name}" (${env.key}) and all its data? This cannot be undone.`,
            refusal: `Not deleting environment "${env.name}" (${env.key}) without confirmation.`,
          },
          flags.force
        );
        yield* deleteEnvironment(
          scope.organization,
          env,
          deadlineIn(flags.timeout)
        );

        return result(
          {
            deleted: true,
            environment: env.key,
            name: env.name,
            organization: scope.organization,
            project: env.project.slug,
          },
          `✓ Deleted environment "${env.name}" (${env.key}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a sandbox environment and all its data. Asks for confirmation unless --force is passed. Production environments can only be deleted in the dashboard."
  ),
  Command.withShortDescription("Delete a sandbox environment.")
);

export const envCommand = Command.make("env").pipe(
  Command.withDescription(
    "Create, inspect and delete Saleor Cloud environments. An environment is one running Saleor instance with its own GraphQL API and dashboard."
  ),
  Command.withShortDescription("Manage environments."),
  Command.withSubcommands([envList, envGet, envCreate, envDelete])
);
