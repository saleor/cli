import path from "node:path";
import { Effect, Option } from "effect";
import { Flag } from "effect/cli";
import { result } from "../../../core/command.ts";
import { timeoutFlag } from "../../../core/flags.ts";
import { deadlineIn } from "../../../core/readiness.ts";
import { domainLabelDescription, regionDescription } from "../flags.ts";
import { describeEnvironment, describeProject } from "../lookup.ts";
import { ensureEnvironment, ensureProject } from "../provision.ts";

import { orgFlag, resolveScope, writeLink } from "../scope.ts";

// One command for "give me a working store": project, environment, readiness, link.
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
  noLink: Flag.Boolean("no-link").pipe(
    Flag.withDescription("Do not link this directory to the new environment."),
    Flag.withDefault(false)
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

export const initCloud = (flags: {
  org: Option.Option<string>;
  project: string;
  env: string;
  region: Option.Option<string>;
  domainLabel: Option.Option<string>;
  timeout: number;
  noLink: boolean;
}) =>
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

    return result<unknown>(
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
  });
