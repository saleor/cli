import { Config, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import { fail } from "../../core/errors.ts";
import { readLinkSection, writeLinkSections } from "../../core/link.ts";
import { readTargetRef } from "../../core/target.ts";
import { listOrganizations } from "./lookup.ts";

// Scope: which organization, project and environment a command acts on. Every command
// selects them the same way — flag → environment variable → project link file
// (.saleor/link.json, written by `saleor link` / `saleor init`) — so the flags live
// here, next to `resolveScope`, which applies that order. There is no global "current"
// selection, so two directories never affect each other.
export const orgFlag = Flag.String("org").pipe(
  Flag.withMetavar("slug"),
  Flag.withDescription(
    "Organization to use. Defaults to SALEOR_ORG, then the directory's link, then your only organization."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_ORG")),
  Flag.optional
);

export const projectFlag = Flag.String("project").pipe(
  Flag.withMetavar("project"),
  Flag.withDescription(
    "Project slug or name. Defaults to SALEOR_PROJECT, then the directory's link."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_PROJECT")),
  Flag.optional
);

export const envFlag = Flag.String("env").pipe(
  Flag.withMetavar("env"),
  Flag.withDescription(
    "Environment name or key. Defaults to SALEOR_ENV, then the directory's link."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_ENV")),
  Flag.optional
);

const CloudLink = Schema.Struct({
  environment: Schema.optionalKey(Schema.String),
  organization: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.String),
});

export type CloudLink = typeof CloudLink.Type;

export const LINK_SECTION = "cloud";

// An environment always belongs to the linked project, so it is only stored with one.
export const linkFor = (
  organization: string,
  project: string | undefined,
  environment: string | undefined
): CloudLink => {
  if (project === undefined) {
    return { organization };
  }

  return environment === undefined
    ? { organization, project }
    : { environment, organization, project };
};

export const readLink = Effect.gen(function* () {
  const link = (yield* readLinkSection(LINK_SECTION, CloudLink)).value ?? {};
  const ref = yield* readTargetRef();

  if (ref?.startsWith("cloud:")) {
    const [organization, project, environment] = ref.slice(6).split("/");

    if (organization && project && environment) {
      return { environment, organization, project };
    }
  }

  // Cloud defaults remain useful with a local target, but its environment cannot leak.
  if (ref?.startsWith("local")) {
    const { environment: _, ...defaults } = link;
    const cloudDefaults: CloudLink = defaults;

    return cloudDefaults;
  }

  return link;
});

export const writeLink = (link: CloudLink) =>
  writeLinkSections({
    cloud: link,
    target:
      link.organization && link.project && link.environment
        ? `cloud:${link.organization}/${link.project}/${link.environment}`
        : undefined,
  });

const chooseOrganization = (flag: Option.Option<string>, link: CloudLink) =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      return flag.value;
    }

    if (link.organization) {
      return link.organization;
    }

    const organizations = yield* listOrganizations;
    const slugs = organizations.map((org) => org.slug);
    const [only] = slugs;

    if (slugs.length === 1 && only !== undefined) {
      return only;
    }

    return yield* slugs.length === 0
      ? fail(
          "ORGANIZATION_REQUIRED",
          "Your account does not belong to any Saleor Cloud organization.",
          {
            suggestion:
              "Create one at https://cloud.saleor.io, then run this command again.",
          }
        )
      : fail(
          "CONTEXT_MISSING",
          `You belong to several organizations (${slugs.join(", ")}); choose one.`,
          {
            details: { organizations: slugs },
            suggestion: `Pass --org <slug> or set SALEOR_ORG.\nTo save it for this directory, run: saleor link --org ${slugs[0]}`,
          }
        );
  });

export interface Scope {
  readonly environment: Option.Option<string>;
  readonly organization: string;
  readonly project: Option.Option<string>;
}

export interface ScopeInput {
  readonly env?: Option.Option<string>;
  readonly org: Option.Option<string>;
  readonly project?: Option.Option<string>;
}

// Resolves the organization, then the project and environment within it. The link
// file's project and environment belong to the link's organization, so they are only
// used when that is the organization selected; `--org other` in a linked directory
// never picks up a project from somewhere else.
export const resolveScope = (input: ScopeInput) =>
  Effect.gen(function* () {
    const link = yield* readLink;
    const organization = yield* chooseOrganization(input.org, link);
    const linked = link.organization === organization ? link : {};

    const scope: Scope = {
      environment: Option.orElse(input.env ?? Option.none(), () =>
        Option.fromUndefinedOr(linked.environment)
      ),
      organization,
      project: Option.orElse(input.project ?? Option.none(), () =>
        Option.fromUndefinedOr(linked.project)
      ),
    };

    return scope;
  });

export const requireScoped = (
  value: Option.Option<string>,
  what: "project" | "environment"
) =>
  Option.match(value, {
    onNone: () =>
      fail("CONTEXT_MISSING", `No ${what} selected.`, {
        suggestion:
          what === "project"
            ? "Pass --project <project> or set SALEOR_PROJECT.\nTo save it for this directory, run: saleor link --project <project>"
            : "Pass the environment name or key, or set SALEOR_ENV.\nTo save it for this directory, run: saleor link --env <env>",
      }),
    onSome: Effect.succeed,
  });
