import { Config, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import { fail } from "../../core/errors.ts";
import { readLinkSection, writeLinkSection } from "../../core/link.ts";
import { CloudApi, orDescribe } from "./api/client.ts";
import { listOrganizations } from "./api/generated.ts";

// Context resolution order: flag → environment variable → project link file
// (.saleor/link.json, written by `saleor link` / `saleor init`). There is no global
// "current" selection, so two directories never affect each other.
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

export type Source = "flag-or-env" | "link-file" | "only-organization";

export const readLink = Effect.map(
  readLinkSection(LINK_SECTION, CloudLink),
  (link) => link.value ?? {}
);

export const writeLink = (link: CloudLink) =>
  writeLinkSection(LINK_SECTION, link);

export const resolveOrganization = (flag: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      return { slug: flag.value, source: "flag-or-env" as const };
    }

    const link = yield* readLink;

    if (link.organization) {
      return { slug: link.organization, source: "link-file" as const };
    }

    const api = yield* CloudApi;
    const organizations = yield* orDescribe(api.call(listOrganizations));
    const [onlyOrganization] = organizations;

    if (organizations.length === 1 && onlyOrganization) {
      return {
        slug: onlyOrganization.slug,
        source: "only-organization" as const,
      };
    }

    const slugs = organizations.map((org) => org.slug);

    return yield* fail(
      organizations.length === 0 ? "ORGANIZATION_REQUIRED" : "CONTEXT_MISSING",
      organizations.length === 0
        ? "Your account has no Saleor Cloud organization."
        : "More than one organization is available; choose one.",
      {
        details: { organizations: slugs },
        suggestion:
          organizations.length === 0
            ? "Create one at https://cloud.saleor.io (opens in the browser), then re-run."
            : "Pass --org <slug>, set SALEOR_ORG, or run `saleor link --org <slug>`.",
      }
    );
  });

export const resolveProjectRef = (flag: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      return Option.some(flag.value);
    }

    const link = yield* readLink;

    return Option.fromUndefinedOr(link.project);
  });

export const resolveEnvironmentRef = (value: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(value)) {
      return Option.some(value.value);
    }

    const fromEnv = process.env.SALEOR_ENV?.trim();

    if (fromEnv) {
      return Option.some(fromEnv);
    }

    const link = yield* readLink;

    return Option.fromUndefinedOr(link.environment);
  });
