import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { preview, result, run } from "../../../core/command.ts";
import { dryRunFlag, forceFlag } from "../../../core/flags.ts";
import { catalogInfo } from "../../../core/input-info.ts";
import { confirmDestructive } from "../../../core/interaction.ts";
import { columns } from "../../../core/output.ts";
import { regionDescription } from "../flags.ts";
import {
  describePricing,
  describeProject,
  findProject,
  listProjects,
} from "../lookup.ts";
import {
  deleteProject,
  ensureProject,
  prepareProject,
  requireEmptyProject,
} from "../provision.ts";
import { orgFlag, resolveScope } from "../scope.ts";

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
              ["SLUG", "NAME", "PLAN", "REGION", "SANDBOXES"],
              ...projects.map((p) => [
                p.slug,
                p.name,
                p.plan,
                p.region,
                p.sandboxes === null ? "" : String(p.sandboxes),
              ]),
            ])
      );
    })
  )
).pipe(
  Command.withDescription("List the projects in an organization."),
  Command.withExamples([
    {
      command: "saleor project list --org acme",
      description: "List the projects in acme",
    },
  ])
);

const projectCreate = Command.make(
  "create",
  {
    confirmPaidPlan: Flag.Boolean("confirm-paid-plan").pipe(
      Flag.withDescription(
        "Agree to pay for a paid --plan. Without it, a paid plan is refused and its price is shown."
      ),
      Flag.withDefault(false)
    ),
    dryRun: dryRunFlag,
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

        const input = {
          confirmPaidPlan: flags.confirmPaidPlan,
          name: flags.name,
          organization,
          plan: flags.plan,
          region: flags.region,
        };

        if (flags.dryRun) {
          const { existing, plan, region } = yield* prepareProject(input);

          return preview({
            action: existing === undefined ? "create" : "reuse",
            costsMoney: existing === undefined && plan.type !== "dev",
            name: flags.name,
            organization,
            plan: plan.slug,
            pricing: describePricing(plan.pricing),
            project: existing?.slug ?? null,
            region,
            state: existing === undefined ? "absent" : "exists",
          });
        }

        const { project, created } = yield* ensureProject(input);

        const details = describeProject(organization, project);

        return result(
          { ...details, created },
          `${created ? `✓ Created project "${details.slug}"` : `✓ Project "${details.slug}" already exists`} (plan ${details.plan}, ${details.region}).`
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
    dryRun: dryRunFlag,
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
          if (flags.dryRun) {
            return preview({
              action: "none",
              organization,
              project: flags.name,
              state: "absent",
            });
          }

          return result(
            { deleted: false, organization, project: flags.name },
            `✓ Project "${flags.name}" does not exist in ${organization}, so there is nothing to delete.`
          );
        }

        const project = found.value;

        yield* requireEmptyProject(organization, project);

        if (flags.dryRun) {
          return preview({
            ...describeProject(organization, project),
            action: "delete",
            project: project.slug,
            state: "empty",
          });
        }

        yield* confirmDestructive(
          {
            question: `Delete project "${project.slug}" in ${organization}? This cannot be undone.`,
            refusal: `Not deleting project "${project.slug}" in ${organization} without confirmation.`,
          },
          flags.force
        );
        yield* deleteProject(organization, project);

        return result(
          { deleted: true, organization, project: project.slug },
          `✓ Deleted project "${project.slug}" in ${organization}.`
        );
      })
    )
).pipe(
  Command.withDescription(
    "Delete a project. It must have no environments left; delete them first with saleor env delete."
  ),
  Command.withShortDescription("Delete an empty project."),
  Command.withExamples([
    {
      command: "saleor project delete my-store --org acme --force",
      description: "Delete an empty project without a question",
    },
  ])
);

export const projectCommand = Command.make("project").pipe(
  Command.withDescription(
    "Create, list and delete Saleor Cloud projects. A project groups environments and sets their billing plan and region."
  ),
  Command.withShortDescription("Manage projects."),
  Command.withSubcommands([projectList, projectCreate, projectDelete])
);

catalogInfo.command("saleor project delete", {
  costsMoney: false,
  destructive: true,
  warning: "Permanently deletes an empty project.",
});

catalogInfo.command("saleor project create", {
  costsMoney: true,
  destructive: false,
  warning:
    "Creating a project on a paid plan incurs charges; requires --confirm-paid-plan.",
});
