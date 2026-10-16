import { Config, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import { fail } from "../../core/errors.ts";
import { readLinkSection, writeLinkSection } from "../../core/link.ts";
import { listOrganizations } from "./lookup.ts";

// Scope: which organization, project and environment a command acts on. Every command
// selects them the same way — flag → environment variable → project link file
// (.saleor/link.json, written by `saleor link` / `saleor init`) — so the flags live
// here, next to `resolveScope`, which applies that order. There is no global "current"
// selection, so two directories never affect each other.
export const orgFlag = Flag.String("org").pipe(
  Flag.withDescription(
    "Organization slug. Falls back to SALEOR_ORG, then the link file."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_ORG")),
  Flag.optional
);

export const projectFlag = Flag.String("project").pipe(
  Flag.withDescription(
    "Project slug or name. Falls back to SALEOR_PROJECT, then the link file."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_PROJECT")),
  Flag.optional
);

export const envFlag = Flag.String("env").pipe(
  Flag.withDescription(
    "Environment name or key. Falls back to SALEOR_ENV, then the link file."
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

export const readLink = Effect.map(
  readLinkSection(LINK_SECTION, CloudLink),
  (link) => link.value ?? {}
);

export const writeLink = (link: CloudLink) =>
  writeLinkSection(LINK_SECTION, link);

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
          "Your account has no Saleor Cloud organization.",
          {
            suggestion:
              "Create one at https://cloud.saleor.io (opens in the browser), then re-run.",
          }
        )
      : fail(
          "CONTEXT_MISSING",
          "More than one organization is available; choose one.",
          {
            details: { organizations: slugs },
            suggestion:
              "Pass --org <slug>, set SALEOR_ORG, or run `saleor link --org <slug>`.",
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
            ? "Pass --project <slug>, set SALEOR_PROJECT, or run `saleor link --project <slug>`."
            : "Pass the environment name or key, set SALEOR_ENV, or run `saleor link --env <name>`.",
      }),
    onSome: Effect.succeed,
  });
