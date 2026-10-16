import { Config, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import {
  orgFlag,
  projectFlag,
  requireScoped,
  resolveScope,
} from "../context.ts";
import {
  describeEnvironment,
  type EnvironmentDetails,
  findEnvironment,
  isSandbox,
  listEnvironments,
  projectSlugOf,
  requireEnvironment,
  requireProject,
} from "../lookup.ts";
import { deleteEnvironment, ensureEnvironment } from "../provision.ts";
import { deadlineIn } from "../readiness.ts";
import { forceFlag, timeoutFlag } from "./flags.ts";

export const envText = (env: EnvironmentDetails) =>
  [
    `${env.name} (${env.key}) in ${env.organization}/${env.project}`,
    `  GraphQL:   ${env.graphqlUrl}`,
    `  Dashboard: ${env.dashboardUrl}`,
    `  Saleor ${env.saleorVersion ?? "?"} · ${env.serviceType} · ${env.region}`,
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

        return result(
          envs,
          envs
            .map(
              (env) =>
                `${env.key}  ${env.name}  ${env.project}  ${env.serviceType}  ${env.graphqlUrl}`
            )
            .join("\n") || "No environments."
        );
      })
    )
).pipe(
  Command.withDescription(
    "List environments, optionally only those of one project."
  )
);

const envGet = Command.make(
  "get",
  {
    env: Argument.String("env").pipe(
      Argument.withDescription(
        "Environment name or key. Falls back to SALEOR_ENV, then the link file."
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
).pipe(Command.withDescription("Show an environment's connection details."));

const envCreate = Command.make(
  "create",
  {
    domainLabel: Flag.String("domain-label").pipe(
      Flag.withDescription(
        "Subdomain for <label>.saleor.cloud. Omit to take a pre-warmed environment (faster; Saleor Cloud picks the label)."
      ),
      Flag.optional
    ),
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "Environment name, unique in the project. Re-running with it continues or reuses."
      )
    ),
    org: orgFlag,
    project: projectFlag,
    service: Flag.String("service").pipe(
      Flag.withDescription(
        "Saleor service (version) name. Default: newest sandbox service."
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
          `${created ? "✓ Created" : "✓ Ready (reused)"} ${envText(details)}`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Create a sandbox environment and wait until its API answers. Safe to re-run after an interruption."
  ),
  Command.withExamples([
    {
      command: "saleor env create dev --org acme --project my-store",
      description: "Pre-warmed sandbox, ready in seconds when the pool has one",
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
            `Environment ${flags.env} does not exist; nothing to delete.`
          );
        }

        const env = found.value;

        if (!isSandbox(env)) {
          return yield* fail(
            "PRODUCTION_DELETE_REFUSED",
            `"${env.name}" is a ${env.service.service_type} environment; this CLI only deletes sandboxes.`,
            {
              suggestion: `Delete it in the dashboard: https://cloud.saleor.io/org/${scope.organization}/environments/${env.key}`,
            }
          );
        }

        yield* confirmDestructive(
          `Delete environment "${env.name}" (${env.key}) and all its data?`,
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
          `✓ Deleted environment ${env.name} (${env.key}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a sandbox environment. Production and other non-sandbox environments are refused."
  )
);

export const envCommand = Command.make("env").pipe(
  Command.withDescription("Saleor Cloud environments (stores)."),
  Command.withSubcommands([envList, envGet, envCreate, envDelete])
);
