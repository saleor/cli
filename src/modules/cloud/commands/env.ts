import { Config, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { preview, result, run } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import {
  dryRunFlag,
  forceFlag,
  timeoutFlag,
  waitFlag,
} from "../../../core/flags.ts";
import { catalogInfo } from "../../../core/input-info.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { columns } from "../../../core/output.ts";
import { deadlineIn, probeGraphql } from "../../../core/readiness.ts";
import type { InstanceState } from "../../../core/target.ts";
import { domainLabelDescription } from "../flags.ts";
import {
  describeEnvironment,
  describeProject,
  type EnvironmentDetails,
  findEnvironment,
  graphqlUrlOf,
  isSandbox,
  listEnvironments,
  projectSlugOf,
  requireEnvironment,
  requireProjectRef,
  serviceTypeLabel,
} from "../lookup.ts";
import {
  deleteEnvironment,
  ensureEnvironment,
  prepareEnvironment,
} from "../provision.ts";

import { orgFlag, projectFlag, requireScoped, resolveScope } from "../scope.ts";

const stateText: Record<InstanceState, string> = {
  busy: "busy: Saleor Cloud is running a task on it (setup, upgrade or deletion)",
  incomplete: "incomplete",
  maintenance: "in maintenance mode",
  ready: "ready: its GraphQL API answers",
  running: "running",
  starting: "starting: its GraphQL API does not answer yet",
  stopped: "stopped",
};

export const envText = (env: EnvironmentDetails) =>
  [
    `Environment "${env.name}" (${env.key}) in ${env.organization} / ${env.project}`,
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
  ].join("\n");

catalogInfo.argument("saleor env get", "env", { env: "SALEOR_ENV" });

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
                ["NAME", "KEY", "PROJECT", "TYPE", "STATE", "GRAPHQL API"],
                ...envs.map((env) => [
                  env.name,
                  env.key,
                  env.project,
                  env.serviceType ?? "",
                  env.state,
                  env.graphqlUrl,
                ]),
              ])
        );
      })
    )
).pipe(
  Command.withDescription(
    "List environments in an organization. Narrowed to one project with --project."
  ),
  Command.withShortDescription("List environments."),
  Command.withExamples([
    {
      command: "saleor env list --org acme --project my-store",
      description: "List the environments of one project",
    },
  ])
);

const envGet = Command.make(
  "get",
  {
    env: Argument.String("env").pipe(
      Argument.withDescription(
        "Environment name or key. Defaults to SALEOR_ENV."
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

        // Like `local status`, ask the store itself, unless Cloud says it is busy.
        const apiAnswered =
          env.blocking_tasks_in_progress || env.maintenance_mode
            ? undefined
            : yield* probeGraphql(graphqlUrlOf(env));

        const details = describeEnvironment(
          scope.organization,
          env,
          apiAnswered
        );

        return result(details, envText(details));
      })
    )
).pipe(
  Command.withDescription(
    "Show an environment's state, GraphQL API and dashboard URLs. Checks whether its GraphQL API answers, unless Saleor Cloud reports it busy."
  ),
  Command.withShortDescription("Show an environment's state and URLs."),
  Command.withExamples([
    {
      command: "saleor env get dev --org acme --project my-store",
      description: "Show the dev environment of my-store",
    },
  ])
);

const envCreate = Command.make(
  "create",
  {
    domainLabel: Flag.String("domain-label").pipe(
      Flag.withMetavar("label"),
      Flag.withDescription(domainLabelDescription),
      Flag.optional
    ),
    dryRun: dryRunFlag,
    force: forceFlag,
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

        const project = yield* requireProjectRef(
          scope.organization,
          scope.project
        );

        const input = {
          deadline: deadlineIn(flags.timeout),
          domainLabel: flags.domainLabel,
          force: flags.force,
          name: flags.name,
          organization: scope.organization,
          project,
          service: flags.service,
        };

        if (flags.dryRun) {
          const prepared = yield* prepareEnvironment(input);

          return preview({
            action: prepared.existing === undefined ? "create" : "reuse",
            costsMoney:
              prepared.existing === undefined && project.plan.type !== "dev",
            domainLabel:
              prepared.existing?.domain_label ??
              Option.getOrNull(flags.domainLabel),
            key: prepared.existing?.key ?? null,
            name: flags.name,
            organization: scope.organization,
            plan: project.plan.slug,
            pricing: describeProject(scope.organization, project).pricing,
            project: project.slug,
            region: project.region,
            service: prepared.service,
            state:
              prepared.existing === undefined
                ? "absent"
                : describeEnvironment(scope.organization, prepared.existing)
                    .state,
          });
        }

        const { environment, created } = yield* ensureEnvironment(input);

        // ensureEnvironment returns only once the GraphQL API answered.
        const details = describeEnvironment(
          scope.organization,
          environment,
          true
        );

        return result(
          { ...details, created },
          `✓ Environment "${details.name}" is ready (${created ? "created" : "already existed"}).\n${envText(details)}`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Create a sandbox environment and wait until its GraphQL API responds. Paid projects require confirmation or --force. If the name already exists, the environment is reused, so re-running after an interruption picks up where it stopped."
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
    dryRun: dryRunFlag,
    env: Argument.String("env").pipe(
      Argument.withDescription(
        "Environment name or key. Always required: deletes never use SALEOR_ENV."
      )
    ),
    force: forceFlag,
    org: orgFlag,
    project: projectFlag,
    timeout: waitFlag(
      "How long to wait until the environment is gone (default 600; 0 returns once Saleor Cloud accepts the deletion). Deletion continues after that; run the same command again to keep waiting (exit code 75 until then)."
    ),
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const scope = yield* resolveScope({
          dryRun: flags.dryRun,
          org: flags.org,
        });

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
          if (flags.dryRun) {
            return preview({
              action: "none",
              environment: flags.env,
              key: null,
              organization: scope.organization,
              project: projectSlug ?? null,
              state: "absent",
            });
          }

          return result(
            {
              deleted: false,
              environment: flags.env,
              organization: scope.organization,
              project: projectSlug ?? null,
            },
            `✓ Environment "${flags.env}" does not exist in ${[scope.organization, projectSlug].filter(Boolean).join(" / ")}, so there is nothing to delete.`
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

        const details = describeEnvironment(scope.organization, env);

        if (flags.dryRun) {
          return preview({ ...details, action: "delete" });
        }

        yield* confirmDestructive(
          {
            question: `Delete environment "${env.name}" (${env.key}) in ${scope.organization} / ${env.project.slug} and all its data? This cannot be undone.`,
            refusal: `Not deleting environment "${env.name}" (${env.key}) in ${scope.organization} / ${env.project.slug} without confirmation.`,
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
          `✓ Deleted environment "${env.name}" (${env.key}) in ${scope.organization} / ${env.project.slug}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a sandbox environment and all its data. Asks for confirmation unless --force is passed. Production environments can only be deleted in the dashboard."
  ),
  Command.withShortDescription("Delete a sandbox environment."),
  Command.withExamples([
    {
      command:
        "saleor env delete preview --org acme --project my-store --force",
      description: "Delete the preview sandbox without a question",
    },
  ])
);

export const envCommand = Command.make("env").pipe(
  Command.withDescription(
    "Create, inspect and delete Saleor Cloud environments. An environment is one running Saleor instance with its own GraphQL API and dashboard."
  ),
  Command.withShortDescription("Manage environments."),
  Command.withSubcommands([envList, envGet, envCreate, envDelete])
);

catalogInfo.command("saleor env delete", {
  costsMoney: false,
  destructive: true,
  warning: "Permanently deletes the sandbox and all its data.",
});

catalogInfo.command("saleor env create", {
  costsMoney: true,
  destructive: false,
  warning:
    "Creating a new environment in a paid project may incur charges; requires confirmation or --force.",
});
