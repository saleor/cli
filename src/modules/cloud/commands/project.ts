import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { result, run } from "../../../core/command.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { columns } from "../../../core/output.ts";
import { describeProject, findProject, listProjects } from "../lookup.ts";
import {
  deleteProject,
  ensureProject,
  requireEmptyProject,
} from "../provision.ts";
import { orgFlag, resolveScope } from "../scope.ts";
import { forceFlag, regionDescription } from "./flags.ts";

const projectList = Command.make("list", { org: orgFlag }, (flags) =>
  run(
    Effect.gen(function* () {
      const { organization } = yield* resolveScope(flags);

      const projects = (yield* listProjects(organization)).map((p) =>
        describeProject(organization, p)
      );

      return result(
        projects,
        projects.length === 0
          ? `No projects in ${organization}. Create one with: saleor project create <name>`
          : columns([
              ["PROJECT", "NAME", "PLAN", "REGION"],
              ...projects.map((p) => [p.slug, p.name, p.plan, p.region]),
            ])
      );
    })
  )
).pipe(Command.withDescription("List the projects in an organization."));

const projectCreate = Command.make(
  "create",
  {
    confirmPaidPlan: Flag.Boolean("confirm-paid-plan").pipe(
      Flag.withDescription(
        "Agree to pay for a paid --plan. Without it, a paid plan is refused and its price is shown."
      ),
      Flag.withDefault(false)
    ),
    name: Argument.String("name").pipe(
      Argument.withDescription(
        "Name for the project. If a project with this name exists, it is reused."
      )
    ),
    org: orgFlag,
    plan: Flag.String("plan").pipe(
      Flag.withMetavar("slug"),
      Flag.withDescription('Billing plan. Defaults to "dev", the free plan.'),
      Flag.optional
    ),
    region: Flag.String("region").pipe(
      Flag.withMetavar("region"),
      Flag.withDescription(regionDescription),
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
          `${created ? "✓ Created project" : "✓ Project already exists:"} ${details.slug} (plan ${details.plan}, ${details.region}).`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Create a project. If one with this name already exists, it is reused."
  ),
  Command.withExamples([
    {
      command: "saleor project create my-store --org acme",
      description: "Create a project on the free plan",
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
            `Project "${flags.name}" does not exist, so there is nothing to delete.`
          );
        }

        const project = found.value;

        yield* requireEmptyProject(organization, project);
        yield* confirmDestructive(
          {
            question: `Delete project "${project.slug}" in ${organization}? This cannot be undone.`,
            refusal: `Not deleting project "${project.slug}" without confirmation.`,
          },
          flags.force
        );
        yield* deleteProject(organization, project);

        return result(
          { deleted: true, organization, project: project.slug },
          `✓ Deleted project "${project.slug}".`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a project. It must have no environments left; delete them first with saleor env delete."
  ),
  Command.withShortDescription("Delete an empty project.")
);

export const projectCommand = Command.make("project").pipe(
  Command.withDescription(
    "Create, list and delete Saleor Cloud projects. A project groups environments and sets their billing plan and region."
  ),
  Command.withShortDescription("Manage projects."),
  Command.withSubcommands([projectList, projectCreate, projectDelete])
);
