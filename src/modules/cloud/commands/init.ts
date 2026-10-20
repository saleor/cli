import { Effect, Option } from "effect";
import { Flag } from "effect/cli";
import { result } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import { timeoutFlag } from "../../../core/flags.ts";
import { isInteractive } from "../../../core/interaction.ts";
import { Invocation } from "../../../core/invocation.ts";
import { deadlineIn } from "../../../core/readiness.ts";
import { domainLabelDescription, regionDescription } from "../flags.ts";
import { describeEnvironment, describeProject } from "../lookup.ts";
import { promptInitChoices } from "../prompt.ts";
import { ensureEnvironment, ensureProject } from "../provision.ts";

import { orgFlag, resolveScope } from "../scope.ts";

// One command for "give me a working store": project, environment, readiness.
// Every step is create-or-reuse by name, so re-running after an interruption continues.
export const cloudInitFlags = {
  domainLabel: Flag.String("domain-label").pipe(
    Flag.withMetavar("label"),
    Flag.withDescription(domainLabelDescription),
    Flag.optional
  ),
  env: Flag.String("env").pipe(
    Flag.withMetavar("name"),
    Flag.withDescription(
      "Cloud environment name. Created, or reused if it exists."
    ),
    Flag.optional
  ),
  org: orgFlag,
  project: Flag.String("project").pipe(
    Flag.withMetavar("name"),
    Flag.withDescription(
      "Cloud project name. Created, or reused if it exists."
    ),
    Flag.optional
  ),
  region: Flag.String("region").pipe(
    Flag.withMetavar("region"),
    Flag.withDescription(regionDescription),
    Flag.optional
  ),
  timeout: timeoutFlag,
};

const noRerunFlags: readonly string[] = [];

export const initCloud = (flags: {
  org: Option.Option<string>;
  project: Option.Option<string>;
  env: Option.Option<string>;
  region: Option.Option<string>;
  domainLabel: Option.Option<string>;
  timeout: number;
}) =>
  Effect.gen(function* () {
    const { env, project } = flags;
    const given = Option.all({ env, project });

    // Checked before any request: bare `init` without a terminal fails offline.
    if (Option.isNone(given) && !(yield* isInteractive)) {
      return yield* fail(
        "USAGE_ERROR",
        "Cloud setup requires --project <name> and --env <name>.",
        {
          suggestion:
            "Pass both flags, or run `saleor init` in a terminal to be asked.\nFor a local store, run: saleor init --local",
        }
      );
    }

    const { organization } = yield* resolveScope({ org: flags.org });

    const choices = Option.isSome(given)
      ? {
          env: given.value.env,
          project: given.value.project,
          region: flags.region,
          rerunFlags: noRerunFlags,
        }
      : yield* promptInitChoices({
          env: flags.env,
          organization,
          project: flags.project,
          region: flags.region,
        });

    // Answers given at a prompt are not in the command line; a resume hint without them
    // would ask the same questions again and could pick different resources.
    const resumeWith = Effect.provideServiceEffect(
      Invocation,
      Effect.map(Invocation, (argv) => [
        ...argv,
        ...(Option.isNone(flags.org) ? ["--org", organization] : []),
        ...choices.rerunFlags,
      ])
    );

    const projectOutcome = yield* ensureProject({
      confirmPaidPlan: false,
      name: choices.project,
      organization,
      plan: Option.none(),
      region: choices.region,
    }).pipe(resumeWith);

    const envOutcome = yield* ensureEnvironment({
      deadline: deadlineIn(flags.timeout),
      domainLabel: flags.domainLabel,
      name: choices.env,
      organization,
      project: projectOutcome.project,
      service: Option.none(),
    }).pipe(resumeWith);

    const environment = describeEnvironment(
      organization,
      envOutcome.environment
    );

    return result<unknown>(
      {
        environment: {
          ...environment,
          created: envOutcome.created,
          ready: true,
        },
        organization,
        project: {
          ...describeProject(organization, projectOutcome.project),
          created: projectOutcome.created,
        },
      },
      [
        projectOutcome.created || envOutcome.created
          ? "✓ Ready."
          : `✓ Nothing to create: "${environment.name}" already exists and is ready.`,
        `  Project:     ${projectOutcome.project.slug} (${projectOutcome.created ? "created" : "already existed"})`,
        `  Environment: ${environment.name} (${envOutcome.created ? "created" : "already existed"})`,
        `  GraphQL API: ${environment.graphqlUrl}`,
        `  Dashboard:   ${environment.dashboardUrl}`,
        `To use it in other commands: --org ${organization} --project ${projectOutcome.project.slug} (or SALEOR_ORG / SALEOR_PROJECT / SALEOR_ENV).`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  });
