import { randomBytes } from "node:crypto";
import path from "node:path";
import { Effect, Option } from "effect";
import { fail } from "../../core/errors.ts";
import {
  askConfirm,
  askSelect,
  askText,
  type Choice,
  isInteractive,
  required,
} from "../../core/interaction.ts";
import { notice } from "../../core/output.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import { listRegions } from "./api/contract.ts";
import { currentUser } from "./auth/current-user.ts";
import { deviceLogin } from "./auth/device-login.ts";
import { Session } from "./auth/session.ts";
import {
  type Environment,
  findProject,
  isSandbox,
  listEnvironments,
  listOrganizations,
  listProjects,
  type Project,
} from "./lookup.ts";
import { DEFAULT_REGION } from "./provision.ts";

// Interactive selection for Cloud commands. Everything here is only reached when a
// person is at a terminal (`isInteractive`); automation gets the structured
// missing-input errors instead. Choices are fetched with the active credentials at the
// moment they become relevant and are never cached.

const NEW = "\0new";

// Offers browser login instead of failing when nobody is logged in. Returns once
// credentials exist, so the original command can continue.
export const ensureSignedIn = Effect.gen(function* () {
  if (!(yield* isInteractive)) {
    return;
  }

  const session = yield* Session;

  const signedIn = yield* session.credential.pipe(
    Effect.as(true),
    Effect.catchIf(
      (failure) => failure.code === "AUTH_REQUIRED",
      (failure) =>
        Effect.gen(function* () {
          yield* notice("You are not logged in to Saleor Cloud.");

          if (!(yield* askConfirm("Log in now in your browser?"))) {
            return yield* failure;
          }

          yield* deviceLogin(true);

          return false;
        })
    )
  );

  if (!signedIn) {
    const user = yield* currentUser;
    yield* notice(`✓ Logged in as ${user.email}.`);
  }
});

export const pickOrganization = () =>
  Effect.gen(function* () {
    const organizations = yield* listOrganizations;
    const [only] = organizations;

    if (only === undefined) {
      return yield* fail(
        "ORGANIZATION_REQUIRED",
        "Your account does not belong to any Saleor Cloud organization.",
        {
          suggestion:
            "Create one at https://cloud.saleor.io, then run this command again.",
        }
      );
    }

    if (organizations.length === 1) {
      return only.slug;
    }

    const choices = organizations.map(({ name, slug }) => ({
      hint: slug,
      label: name,
      value: slug,
    }));

    return yield* askSelect({
      choices,
      message: "Organization",
    });
  });

const projectChoice = (project: Project): Choice<string> => ({
  hint: `${project.slug} · ${project.region} · ${project.plan.slug}`,
  label: project.name,
  value: project.slug,
});

const environmentChoice = (env: Environment): Choice<string> => ({
  hint: `${env.key} · ${env.service.service_type?.toLowerCase() ?? "unknown"}`,
  label: env.name,
  value: env.key,
});

export type ProjectSelection =
  | { readonly kind: "existing"; readonly project: Project }
  | { readonly kind: "new" };

// Existing projects plus a "create a new project" row; with no projects, straight to new.
export const pickProject = (organization: string) =>
  Effect.gen(function* () {
    const projects = yield* listProjects(organization);

    if (projects.length === 0) {
      return { kind: "new" } satisfies ProjectSelection;
    }

    const choices: Choice<string>[] = [
      ...projects.map(projectChoice),
      { label: "Create a new project", value: NEW },
    ];

    const answer = yield* askSelect({
      choices,
      message: "Project",
    });

    if (answer === NEW) {
      return { kind: "new" } satisfies ProjectSelection;
    }

    const project = projects.find((p) => p.slug === answer);

    return project === undefined
      ? ({ kind: "new" } satisfies ProjectSelection)
      : ({ kind: "existing", project } satisfies ProjectSelection);
  });

export type EnvironmentSelection =
  | { readonly kind: "existing"; readonly environment: Environment }
  | { readonly kind: "new" };

export const pickEnvironment = (organization: string, projectSlug: string) =>
  Effect.gen(function* () {
    const environments = (yield* listEnvironments(
      organization,
      projectSlug
    )).filter(isSandbox);

    if (environments.length === 0) {
      return { kind: "new" } satisfies EnvironmentSelection;
    }

    const choices: Choice<string>[] = [
      ...environments.map(environmentChoice),
      { label: "Create a new sandbox environment", value: NEW },
    ];

    const answer = yield* askSelect({
      choices,
      message: "Environment",
    });

    if (answer === NEW) {
      return { kind: "new" } satisfies EnvironmentSelection;
    }

    const environment = environments.find((e) => e.key === answer);

    return environment === undefined
      ? ({ kind: "new" } satisfies EnvironmentSelection)
      : ({ environment, kind: "existing" } satisfies EnvironmentSelection);
  });

const pickRegion = Effect.gen(function* () {
  const api = yield* CloudApi;
  const regions = yield* orDescribe(api.call(listRegions));

  if (regions.length <= 1) {
    return Option.fromUndefinedOr(regions[0]?.name);
  }

  return Option.some(
    yield* askSelect({
      choices: regions.map(({ name, root_domain }) => ({
        hint: root_domain,
        label: name,
        value: name,
      })),
      initialValue: regions.some((r) => r.name === DEFAULT_REGION)
        ? DEFAULT_REGION
        : (regions[0]?.name ?? DEFAULT_REGION),
      message: "Region",
    })
  );
});

export interface InitChoices {
  readonly env: string;
  readonly project: string;
  readonly region: Option.Option<string>;
  // Flags the person answered for, to rebuild a rerun command that skips the questions.
  readonly rerunFlags: readonly string[];
}

const askProject = (organization: string, regionFlag: Option.Option<string>) =>
  Effect.gen(function* () {
    const selection = yield* pickProject(organization);

    if (selection.kind === "existing") {
      return {
        existing: selection.project,
        name: selection.project.slug,
        region: regionFlag,
      };
    }

    const name = yield* askText({
      initialValue: path.basename(process.cwd()),
      message: "Project name",
      validate: required("A project name"),
    });

    return {
      existing: undefined,
      name,
      region: Option.isNone(regionFlag) ? yield* pickRegion : regionFlag,
    };
  });

// Sandboxes cannot be told apart by name alone, so a blank answer gets a short random
// suffix; the name is fixed here so the summary and any rerun command carry it.
const randomEnvironmentName = () => `sandbox-${randomBytes(3).toString("hex")}`;

const askNewEnvironmentName = Effect.gen(function* () {
  const name = yield* askText({
    message: "Environment name (leave blank for a random name)",
  });

  return name.trim() === "" ? randomEnvironmentName() : name.trim();
});

const findSandbox = (organization: string, project: Project, name: string) =>
  Effect.map(listEnvironments(organization, project.slug), (environments) =>
    environments.some((env) => isSandbox(env) && env.name === name)
  );

const askEnvironment = (
  organization: string,
  existing: Project | undefined,
  flag: Option.Option<string>
) =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      return {
        existing:
          existing !== undefined &&
          (yield* findSandbox(organization, existing, flag.value)),
        name: flag.value,
      };
    }

    const selection = existing
      ? yield* pickEnvironment(organization, existing.slug)
      : undefined;

    if (selection?.kind === "existing") {
      return { existing: true, name: selection.environment.name };
    }

    return { existing: false, name: yield* askNewEnvironmentName };
  });

const summary = (
  organization: string,
  chosen: {
    readonly env: { readonly existing: boolean; readonly name: string };
    readonly project: {
      readonly existing: Project | undefined;
      readonly name: string;
      readonly region: Option.Option<string>;
    };
  }
) => {
  const { env, project } = chosen;

  const projectPlan =
    project.existing === undefined
      ? `create${Option.isSome(project.region) ? ` in ${project.region.value}` : ""}`
      : "use existing";

  return [
    "",
    `  Organization: ${organization}`,
    `  Project:      ${project.name} — ${projectPlan}`,
    `  Environment:  ${env.name} — ${env.existing ? "use existing sandbox" : "create sandbox"}`,
    "",
  ].join("\n");
};

const resolveProjectFlag = (
  organization: string,
  name: string,
  region: Option.Option<string>
) =>
  Effect.map(findProject(organization, name), (found) => ({
    existing: Option.getOrUndefined(found),
    name,
    region,
  }));

// Fills in whatever `saleor init` was not told: the project (existing or new) and the
// sandbox (existing or new), then asks for a go-ahead before anything is created.
export const promptInitChoices = (input: {
  readonly organization: string;
  readonly project: Option.Option<string>;
  readonly env: Option.Option<string>;
  readonly region: Option.Option<string>;
}) =>
  Effect.gen(function* () {
    const rerunFlags: string[] = [];

    const project = Option.isSome(input.project)
      ? yield* resolveProjectFlag(
          input.organization,
          input.project.value,
          input.region
        )
      : yield* askProject(input.organization, input.region);

    if (Option.isNone(input.project)) {
      rerunFlags.push("--project", project.name);
    }

    if (Option.isNone(input.region) && Option.isSome(project.region)) {
      rerunFlags.push("--region", project.region.value);
    }

    const env = yield* askEnvironment(
      input.organization,
      project.existing,
      input.env
    );

    if (Option.isNone(input.env)) {
      rerunFlags.push("--env", env.name);
    }

    // Picking an existing project and sandbox creates nothing: there is nothing to confirm.
    const reusesBoth = project.existing !== undefined && env.existing;

    if (!reusesBoth) {
      yield* notice(summary(input.organization, { env, project }));
    }

    if (!(reusesBoth || (yield* askConfirm("Continue?")))) {
      return yield* fail("CANCELLED", "Cancelled. Nothing was created.");
    }

    return {
      env: env.name,
      project: project.name,
      region: project.region,
      rerunFlags,
    } satisfies InitChoices;
  });
