import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import {
  type CloudLink,
  envFlag,
  orgFlag,
  projectFlag,
  resolveOrganization,
  writeLink,
} from "../context.ts";
import {
  deadlineIn,
  describeEnvironment,
  describeProject,
  ensureEnvironment,
  ensureProject,
  findEnvironment,
  requireProject,
} from "../provision.ts";
import { commandLine, timeoutFlag } from "./resources.ts";

export const link = Command.make(
  "link",
  { env: envFlag, org: orgFlag, project: projectFlag },
  (flags) =>
    run(
      Effect.gen(function* () {
        const organization = yield* resolveOrganization(flags.org);

        const project = Option.isSome(flags.project)
          ? Option.some(
              yield* requireProject(organization.slug, flags.project.value)
            )
          : Option.none();

        const environment = Option.isSome(flags.env)
          ? yield* Effect.flatMap(
              findEnvironment(
                organization.slug,
                flags.env.value,
                Option.getOrUndefined(project)?.slug
              ),
              (found) =>
                Option.match(found, {
                  onNone: () =>
                    fail(
                      "NOT_FOUND",
                      `Environment "${Option.getOrThrow(flags.env)}" does not exist.`
                    ),
                  onSome: Effect.succeed,
                })
            )
          : undefined;

        const projectSlug =
          Option.getOrUndefined(project)?.slug ?? environment?.project.slug;

        let linked: CloudLink = { organization: organization.slug };

        if (projectSlug) {
          linked = { ...linked, project: projectSlug };
        }

        if (environment) {
          linked = { ...linked, environment: environment.key };
        }

        const file = yield* writeLink(linked);

        return result(
          { file, ...linked },
          `✓ Linked this directory to ${[linked.organization, linked.project, environment?.name].filter(Boolean).join(" / ")} (${file}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Remember the organization, project and environment for this directory in .saleor/link.json (names and keys only, no secrets)."
  )
);

// One command for "give me a working store": project, environment, readiness, link.
// Every step is create-or-reuse by name, so re-running after an interruption continues.
export const init = Command.make(
  "init",
  {
    domainLabel: Flag.String("domain-label").pipe(
      Flag.withDescription("Subdomain; omit for a pre-warmed environment."),
      Flag.optional
    ),
    env: Flag.String("env").pipe(
      Flag.withDescription("Environment name to create or reuse.")
    ),
    noLink: Flag.Boolean("no-link").pipe(
      Flag.withDescription("Do not write .saleor/link.json."),
      Flag.withDefault(false)
    ),
    org: orgFlag,
    project: Flag.String("project").pipe(
      Flag.withDescription("Project name to create or reuse.")
    ),
    region: Flag.String("region").pipe(
      Flag.withDescription('Region for a new project (default "us-east-1").'),
      Flag.optional
    ),
    timeout: timeoutFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const organization = yield* resolveOrganization(flags.org);

        const resume = commandLine(["init"], {
          "domain-label": flags.domainLabel,
          env: flags.env,
          "no-link": flags.noLink,
          org: organization.slug,
          project: flags.project,
          region: flags.region,
        });

        const projectOutcome = yield* ensureProject({
          confirmPaidPlan: false,
          name: flags.project,
          organization: organization.slug,
          plan: Option.none(),
          region: flags.region,
        });

        const envOutcome = yield* ensureEnvironment({
          deadline: deadlineIn(flags.timeout, resume),
          domainLabel: flags.domainLabel,
          name: flags.env,
          organization: organization.slug,
          project: projectOutcome.project,
          service: Option.none(),
        });

        const environment = describeEnvironment(
          organization.slug,
          envOutcome.environment
        );

        const linkFile = flags.noLink
          ? null
          : yield* writeLink({
              environment: environment.key,
              organization: organization.slug,
              project: projectOutcome.project.slug,
            });

        return result(
          {
            environment: {
              ...environment,
              created: envOutcome.created,
              ready: true,
            },
            linkFile,
            organization: organization.slug,
            project: {
              ...describeProject(organization.slug, projectOutcome.project),
              created: projectOutcome.created,
            },
          },
          [
            `✓ ${environment.name} is ready.`,
            `  GraphQL:   ${environment.graphqlUrl}`,
            `  Dashboard: ${environment.dashboardUrl}`,
            linkFile ? `  Linked in ${linkFile}` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      })
    )
).pipe(
  Command.withDescription(
    "Create or reuse a project and a sandbox environment, wait until it is ready, and link this directory."
  ),
  Command.withExamples([
    {
      command: "saleor init --org acme --project my-store --env dev",
      description: "One-shot setup",
    },
  ])
);
