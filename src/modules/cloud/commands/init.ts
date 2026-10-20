import { Config, Effect, Option } from "effect";
import { Flag } from "effect/cli";
import { result } from "../../../core/command.ts";
import { fail } from "../../../core/errors.ts";
import { forceFlag, timeoutFlag } from "../../../core/flags.ts";
import { isInteractive } from "../../../core/interaction.ts";
import { Invocation, shellCommand } from "../../../core/invocation.ts";
import { detectAgent } from "../../../core/output.ts";
import { deadlineIn } from "../../../core/readiness.ts";
import { domainLabelDescription, regionDescription } from "../flags.ts";
import { describeEnvironment } from "../lookup.ts";
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
    Flag.withMetavar("env"),
    Flag.withDescription(
      "Cloud environment name. Created, or reused if it exists. Defaults to SALEOR_ENV."
    ),
    Flag.withFallbackConfig(Config.String("SALEOR_ENV")),
    Flag.optional
  ),
  force: forceFlag,
  org: orgFlag,
  project: Flag.String("project").pipe(
    Flag.withMetavar("project"),
    Flag.withDescription(
      "Cloud project name. Created, or reused if it exists. Defaults to SALEOR_PROJECT."
    ),
    Flag.withFallbackConfig(Config.String("SALEOR_PROJECT")),
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

const missingChoices = (
  project: Option.Option<string>,
  env: Option.Option<string>
) => {
  const missing = [
    ...(Option.isNone(project) ? ["--project <project>"] : []),
    ...(Option.isNone(env) ? ["--env <env>"] : []),
  ];

  const variables = [
    ...(Option.isNone(project) ? ["SALEOR_PROJECT"] : []),
    ...(Option.isNone(env) ? ["SALEOR_ENV"] : []),
  ];

  const agent = detectAgent();

  return fail(
    "CONTEXT_MISSING",
    `Cloud setup needs ${missing.join(" and ")}.`,
    {
      details: { missing },
      suggestion: [
        `Pass ${missing.length > 1 ? "both flags" : "the flag"}, or set ${variables.join(" and ")}.`,
        agent === undefined
          ? "In a terminal, run saleor init without flags to be asked."
          : `Questions are off because a coding agent was detected (${agent}); pass flags instead.`,
        "For a local store, run: saleor init --local",
      ].join("\n"),
    }
  );
};

export const initCloud = (flags: {
  force: boolean;
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
      return yield* missingChoices(project, env);
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
    const resumeArgv = [
      ...(yield* Invocation),
      ...(Option.isNone(flags.org) ? ["--org", organization] : []),
      ...choices.rerunFlags,
    ];

    const resumeWith = Effect.provideService(Invocation, resumeArgv);

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
      force: flags.force,
      name: choices.env,
      organization,
      project: projectOutcome.project,
      service: Option.none(),
    }).pipe(resumeWith);

    // ensureEnvironment returns only once the GraphQL API answered.
    const environment = describeEnvironment(
      organization,
      envOutcome.environment,
      true
    );

    // The same instance shape as `env create` and `init --local`, plus the project.
    return result<unknown>(
      {
        ...environment,
        created: envOutcome.created,
        projectCreated: projectOutcome.created,
      },
      [
        `✓ Environment "${environment.name}" is ready (${envOutcome.created ? "created" : "already existed"}).`,
        `  Project:     "${projectOutcome.project.slug}" (${projectOutcome.created ? "created" : "already existed"})`,
        `  GraphQL API: ${environment.graphqlUrl}`,
        `  Dashboard:   ${environment.dashboardUrl}`,
        "",
        "To use it in other commands, set:",
        `  export SALEOR_ORG=${organization} SALEOR_PROJECT=${projectOutcome.project.slug} SALEOR_ENV=${environment.key}`,
        ...(choices.rerunFlags.length > 0
          ? [
              "To run this setup again without questions:",
              `  ${shellCommand(resumeArgv)}`,
            ]
          : []),
      ].join("\n")
    );
  });
