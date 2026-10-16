import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import {
  envFlag,
  linkFor,
  orgFlag,
  projectFlag,
  resolveScope,
  writeLink,
} from "../context.ts";
import {
  describeEnvironment,
  describeProject,
  projectSlugOf,
  requireEnvironment,
} from "../lookup.ts";
import { ensureEnvironment, ensureProject } from "../provision.ts";
import { deadlineIn } from "../readiness.ts";
import { timeoutFlag } from "./flags.ts";

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
