import path from "node:path";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import {
  describeEnvironment,
  describeProject,
  projectSlugOf,
  requireEnvironment,
} from "../lookup.ts";
import { ensureEnvironment, ensureProject } from "../provision.ts";
import { deadlineIn } from "../readiness.ts";
import {
  envFlag,
  linkFor,
  orgFlag,
  projectFlag,
  resolveScope,
  writeLink,
} from "../scope.ts";
import {
  domainLabelDescription,
  regionDescription,
  timeoutFlag,
} from "./flags.ts";

export const link = Command.make(
  "link",
  { env: envFlag, org: orgFlag, project: projectFlag },
  (flags) =>
    run(
      Effect.gen(function* () {
        // Only what is passed now is linked; the old link's selections are replaced.
        const { organization } = yield* resolveScope({ org: flags.org });
        const projectSlug = yield* projectSlugOf(organization, flags.project);

        const environment = Option.isSome(flags.env)
          ? yield* requireEnvironment(
              organization,
              flags.env.value,
              projectSlug
            )
          : undefined;

        const linked = linkFor(
          organization,
          projectSlug ?? environment?.project.slug,
          environment?.key
        );

        const file = yield* writeLink(linked);

        return result(
          { file, ...linked },
          `✓ This directory now uses ${[linked.organization, linked.project, environment?.name].filter(Boolean).join(" / ")}. Saved in ${path.relative(process.cwd(), file) || file}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Set the organization, project and environment that commands use in this directory, so you can leave out --org, --project and --env. Saved in .saleor/link.json, which holds names only, no secrets. Replaces any earlier link."
  ),
  Command.withShortDescription(
    "Set the default org, project and environment for this directory."
  )
);

// One command for "give me a working store": project, environment, readiness, link.
// Every step is create-or-reuse by name, so re-running after an interruption continues.
export const init = Command.make(
  "init",
  {
    domainLabel: Flag.String("domain-label").pipe(
      Flag.withMetavar("label"),
      Flag.withDescription(domainLabelDescription),
      Flag.optional
    ),
    env: Flag.String("env").pipe(
      Flag.withMetavar("name"),
      Flag.withDescription("Environment name. Created, or reused if it exists.")
    ),
    noLink: Flag.Boolean("no-link").pipe(
      Flag.withDescription(
        "Do not link this directory to the new environment."
      ),
      Flag.withDefault(false)
    ),
    org: orgFlag,
    project: Flag.String("project").pipe(
      Flag.withMetavar("name"),
      Flag.withDescription("Project name. Created, or reused if it exists.")
    ),
    region: Flag.String("region").pipe(
      Flag.withMetavar("region"),
      Flag.withDescription(regionDescription),
      Flag.optional
    ),
    timeout: timeoutFlag,
  },
  (flags) =>
    run(
      Effect.gen(function* () {
        const { organization } = yield* resolveScope({ org: flags.org });

        const projectOutcome = yield* ensureProject({
          confirmPaidPlan: false,
          name: flags.project,
          organization,
          plan: Option.none(),
          region: flags.region,
        });

        const envOutcome = yield* ensureEnvironment({
          deadline: deadlineIn(flags.timeout),
          domainLabel: flags.domainLabel,
          name: flags.env,
          organization,
          project: projectOutcome.project,
          service: Option.none(),
        });

        const environment = describeEnvironment(
          organization,
          envOutcome.environment
        );

        const linkFile = flags.noLink
          ? null
          : yield* writeLink({
              environment: environment.key,
              organization,
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
            organization,
            project: {
              ...describeProject(organization, projectOutcome.project),
              created: projectOutcome.created,
            },
          },
          [
            "✓ Ready.",
            `  Project:     ${projectOutcome.project.slug} (${projectOutcome.created ? "created" : "already existed"})`,
            `  Environment: ${environment.name} (${envOutcome.created ? "created" : "already existed"})`,
            `  GraphQL API: ${environment.graphqlUrl}`,
            `  Dashboard:   ${environment.dashboardUrl}`,
            linkFile
              ? `This directory now uses it; saved in ${path.relative(process.cwd(), linkFile) || linkFile}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
      })
    )
).pipe(
  Command.withDescription(
    "Set up a working store in one step: create the project and a sandbox environment (or reuse them if they exist), wait until it is ready, and link this directory to it. Safe to run again after an interruption."
  ),
  Command.withShortDescription(
    "Create a project and sandbox environment and link this directory."
  ),
  Command.withExamples([
    {
      command: "saleor init --org acme --project my-store --env dev",
      description: "Set up the my-store project with a dev environment",
    },
  ])
);
