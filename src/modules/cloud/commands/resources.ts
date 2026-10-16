import { Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { CloudApi, orDescribe } from "../api/client.ts";
import { destroyProject, listOrganizations } from "../api/generated.ts";
import {
  orgFlag,
  projectFlag,
  resolveEnvironmentRef,
  resolveOrganization,
  resolveProjectRef,
} from "../context.ts";
import {
  deadlineIn,
  deleteEnvironment,
  describeEnvironment,
  describeProject,
  ensureEnvironment,
  ensureProject,
  findEnvironment,
  findProject,
  listEnvironments,
  listProjects,
  requireProject,
} from "../provision.ts";

export const timeoutFlag = Flag.Int("timeout").pipe(
  Flag.withSchema(
    Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)))
  ),
  Flag.withDescription(
    "Seconds to wait before returning NOT_READY (exit 75). Re-running continues the wait."
  ),
  Flag.withDefault(600)
);

const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription(
    "Confirm a destructive action without being asked. Required when there is no terminal."
  ),
  Flag.withDefault(false)
);

const SAFE_SHELL_WORD = /^[a-zA-Z0-9_./:=@-]+$/;

// Rebuilds the exact invocation so NOT_READY and confirmation errors can tell the agent
// what to run next.
export const commandLine = (
  words: readonly string[],
  flags: Record<string, Option.Option<string> | string | boolean | undefined>
) =>
  [
    "saleor",
    ...words,
    ...Object.entries(flags).flatMap(([name, value]) => {
      if (value === undefined || value === false) {
        return [];
      }

      if (value === true) {
        return [`--${name}`];
      }

      if (!Option.isOption(value)) {
        return [`--${name}`, value];
      }

      return Option.isSome(value) ? [`--${name}`, value.value] : [];
    }),
  ]
    .map((word) =>
      SAFE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\"'\"'")}'`
    )
    .join(" ");

const requireProjectRef = (flag: Option.Option<string>) =>
  Effect.flatMap(resolveProjectRef(flag), (ref) =>
    Option.match(ref, {
      onNone: () =>
        fail("CONTEXT_MISSING", "No project selected.", {
          suggestion:
            "Pass --project <slug>, set SALEOR_PROJECT, or run `saleor link --project <slug>`.",
        }),
      onSome: Effect.succeed,
    })
  );

// ── org ──────────────────────────────────────────────────────────────────

const orgList = Command.make("list", {}, () =>
  run(
    Effect.gen(function* () {
      const api = yield* CloudApi;

      const organizations = (yield* orDescribe(
        api.call(listOrganizations)
      )).map((org) => ({
        name: org.name,
        slug: org.slug,
      }));

      return result(
        organizations,
        organizations.map((org) => `${org.slug}  ${org.name}`).join("\n")
      );
    })
  )
).pipe(
  Command.withDescription("List the organizations your account belongs to.")
);

export const orgCommand = Command.make("org").pipe(
  Command.withDescription("Saleor Cloud organizations."),
  Command.withSubcommands([orgList])
);

// ── project ──────────────────────────────────────────────────────────────

const projectList = Command.make("list", { org: orgFlag }, (flags) =>
  run(
    Effect.gen(function* () {
      const organization = yield* resolveOrganization(flags.org);

      const projects = (yield* listProjects(organization.slug)).map((p) =>
        describeProject(organization.slug, p)
      );

      return result(
        projects,
        projects
          .map(
            (p) => `${p.slug}  ${p.name}  plan=${p.plan}  region=${p.region}`
          )
          .join("\n") || `No projects in ${organization.slug}.`
      );
    })
  )
).pipe(Command.withDescription("List projects in an organization."));

const projectCreate = Command.make(
  "create",
  {
    confirmPaidPlan: Flag.Boolean("confirm-paid-plan").pipe(
      Flag.withDescription(
        "Accept the cost of a paid plan. Without it a paid plan is refused and its pricing shown."
      ),
      Flag.withDefault(false)
    ),
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "Project name. Re-running with the same name reuses it."
      )
    ),
    org: orgFlag,
    plan: Flag.String("plan").pipe(
      Flag.withDescription('Plan slug (default "dev", the free plan).'),
      Flag.optional
    ),
    region: Flag.String("region").pipe(
      Flag.withDescription('Region (default "us-east-1").'),
      Flag.optional
    ),
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const organization = yield* resolveOrganization(flags.org);

        const { project, created } = yield* ensureProject({
          confirmPaidPlan: flags.confirmPaidPlan,
          name: flags.name,
          organization: organization.slug,
          plan: flags.plan,
          region: flags.region,
        });

        const details = describeProject(organization.slug, project);

        return result(
          { ...details, created },
          `${created ? "✓ Created" : "✓ Reusing"} project ${details.slug} (plan ${details.plan}, ${details.region}).`
        );
      })
    )
).pipe(
  Command.withDescription("Create a project, or reuse the one with this name."),
  Command.withExamples([
    {
      command: "saleor project create my-store --org acme",
      description: "Free dev-plan project",
    },
  ])
);

const projectDelete = Command.make(
  "delete",
  {
    force: forceFlag,
    name: Argument.String("project").pipe(
      Argument.withDescription("Project slug or name.")
    ),
    org: orgFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const api = yield* CloudApi;
        const organization = yield* resolveOrganization(flags.org);
        const found = yield* findProject(organization.slug, flags.name);

        if (Option.isNone(found)) {
          return result(
            {
              deleted: false,
              organization: organization.slug,
              project: flags.name,
            },
            `Project ${flags.name} does not exist; nothing to delete.`
          );
        }

        const project = found.value;

        const environments = yield* listEnvironments(
          organization.slug,
          project.slug
        );

        if (environments.length > 0) {
          return yield* fail(
            "PROJECT_NOT_EMPTY",
            `Project "${project.slug}" still has ${environments.length} environment(s).`,
            {
              details: {
                environments: environments.map((env) => ({
                  key: env.key,
                  name: env.name,
                })),
              },
              suggestion:
                "Delete its environments first with `saleor env delete`.",
            }
          );
        }

        yield* confirmDestructive(
          `Delete project "${project.slug}" in ${organization.slug}?`,
          flags.force,
          commandLine(["project", "delete", project.slug], {
            force: true,
            org: organization.slug,
          })
        );
        yield* orDescribe(
          api
            .call(destroyProject, {
              path: {
                organization_slug: organization.slug,
                slug: project.slug,
              },
            })
            .pipe(
              Effect.catchTag("ApiStatusError", (error) =>
                error.status === 404 ? Effect.void : Effect.fail(error)
              )
            )
        );

        return result(
          {
            deleted: true,
            organization: organization.slug,
            project: project.slug,
          },
          `✓ Deleted project ${project.slug}.`
        );
      })
    )
).pipe(Command.withDescription("Delete an empty project."));

export const projectCommand = Command.make("project").pipe(
  Command.withDescription("Saleor Cloud projects."),
  Command.withSubcommands([projectList, projectCreate, projectDelete])
);

// ── env ──────────────────────────────────────────────────────────────────

const envText = (env: ReturnType<typeof describeEnvironment>) =>
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
        const organization = yield* resolveOrganization(flags.org);
        const projectRef = yield* resolveProjectRef(flags.project);

        const projectSlug = Option.isSome(projectRef)
          ? (yield* requireProject(organization.slug, projectRef.value)).slug
          : undefined;

        const envs = (yield* listEnvironments(
          organization.slug,
          projectSlug
        )).map((env) => describeEnvironment(organization.slug, env));

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
        "Environment name or key (default: the linked one)."
      ),
      Argument.optional
    ),
    org: orgFlag,
    project: projectFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const organization = yield* resolveOrganization(flags.org);
        const ref = yield* resolveEnvironmentRef(flags.env);

        if (Option.isNone(ref)) {
          return yield* fail("CONTEXT_MISSING", "No environment selected.", {
            suggestion:
              "Pass the environment name or key, or run `saleor link --env <name>`.",
          });
        }

        const projectRef = yield* resolveProjectRef(flags.project);

        const projectSlug = Option.isSome(projectRef)
          ? (yield* requireProject(organization.slug, projectRef.value)).slug
          : undefined;

        const env = yield* findEnvironment(
          organization.slug,
          ref.value,
          projectSlug
        );

        if (Option.isNone(env)) {
          return yield* fail(
            "NOT_FOUND",
            `Environment "${ref.value}" does not exist.`,
            {
              suggestion: "List them with `saleor env list`.",
            }
          );
        }

        const details = describeEnvironment(organization.slug, env.value);

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
        const organization = yield* resolveOrganization(flags.org);
        const projectRef = yield* requireProjectRef(flags.project);
        const project = yield* requireProject(organization.slug, projectRef);

        const resume = commandLine(["env", "create", flags.name], {
          "domain-label": flags.domainLabel,
          org: organization.slug,
          project: project.slug,
          service: flags.service,
        });

        const { environment, created } = yield* ensureEnvironment({
          deadline: deadlineIn(flags.timeout, resume),
          domainLabel: flags.domainLabel,
          name: flags.name,
          organization: organization.slug,
          project,
          service: flags.service,
        });

        const details = describeEnvironment(organization.slug, environment);

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
        const organization = yield* resolveOrganization(flags.org);
        const projectRef = yield* resolveProjectRef(flags.project);

        const projectSlug = Option.isSome(projectRef)
          ? (yield* requireProject(organization.slug, projectRef.value)).slug
          : undefined;

        const found = yield* findEnvironment(
          organization.slug,
          flags.env,
          projectSlug
        );

        if (Option.isNone(found)) {
          return result(
            {
              deleted: false,
              environment: flags.env,
              organization: organization.slug,
            },
            `Environment ${flags.env} does not exist; nothing to delete.`
          );
        }

        const env = found.value;

        if (env.service.service_type === "PRODUCTION") {
          return yield* fail(
            "PRODUCTION_DELETE_REFUSED",
            `"${env.name}" is a production environment; this CLI does not delete production.`,
            {
              suggestion: `Delete it in the dashboard: https://cloud.saleor.io/org/${organization.slug}/environments/${env.key}`,
            }
          );
        }

        const resume = commandLine(["env", "delete", env.key], {
          force: true,
          org: organization.slug,
        });

        yield* confirmDestructive(
          `Delete environment "${env.name}" (${env.key}) and all its data?`,
          flags.force,
          resume
        );
        yield* deleteEnvironment(
          organization.slug,
          env,
          deadlineIn(flags.timeout, resume)
        );

        return result(
          {
            deleted: true,
            environment: env.key,
            name: env.name,
            organization: organization.slug,
            project: env.project.slug,
          },
          `✓ Deleted environment ${env.name} (${env.key}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a sandbox environment. Production environments are refused."
  )
);

export const envCommand = Command.make("env").pipe(
  Command.withDescription("Saleor Cloud environments (stores)."),
  Command.withSubcommands([envList, envGet, envCreate, envDelete])
);
