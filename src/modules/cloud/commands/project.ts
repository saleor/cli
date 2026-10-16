import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { describeProject, findProject, listProjects } from "../lookup.ts";
import {
  deleteProject,
  ensureProject,
  requireEmptyProject,
} from "../provision.ts";
import { orgFlag, resolveScope } from "../scope.ts";
import { forceFlag } from "./flags.ts";

const projectList = Command.make("list", { org: orgFlag }, (flags) =>
  run(
    Effect.gen(function* () {
      const { organization } = yield* resolveScope(flags);

      const projects = (yield* listProjects(organization)).map((p) =>
        describeProject(organization, p)
      );

      return result(
        projects,
        projects
          .map(
            (p) => `${p.slug}  ${p.name}  plan=${p.plan}  region=${p.region}`
          )
          .join("\n") || `No projects in ${organization}.`
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
        const { organization } = yield* resolveScope(flags);

        const { project, created } = yield* ensureProject({
          confirmPaidPlan: flags.confirmPaidPlan,
          name: flags.name,
          organization,
          plan: flags.plan,
          region: flags.region,
        });

        const details = describeProject(organization, project);

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
        const { organization } = yield* resolveScope(flags);
        const found = yield* findProject(organization, flags.name);

        if (Option.isNone(found)) {
          return result(
            { deleted: false, organization, project: flags.name },
            `Project ${flags.name} does not exist; nothing to delete.`
          );
        }

        const project = found.value;

        yield* requireEmptyProject(organization, project);
        yield* confirmDestructive(
          `Delete project "${project.slug}" in ${organization}?`,
          flags.force
        );
        yield* deleteProject(organization, project);

        return result(
          { deleted: true, organization, project: project.slug },
          `✓ Deleted project ${project.slug}.`
        );
      })
    )
).pipe(Command.withDescription("Delete an empty project."));

export const projectCommand = Command.make("project").pipe(
  Command.withDescription("Saleor Cloud projects."),
  Command.withSubcommands([projectList, projectCreate, projectDelete])
);
