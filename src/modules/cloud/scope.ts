import { Config, Effect, Option } from "effect";
import { Flag } from "effect/cli";
import { fail } from "../../core/errors.ts";
import { catalogInfo } from "../../core/input-info.ts";
import { isInteractive } from "../../core/interaction.ts";
import { listOrganizations } from "./lookup.ts";
import { ensureSignedIn, pickOrganization } from "./prompt.ts";

// Scope: which organization, project and environment a command acts on. Every command
// selects them the same way — flag → environment variable → (for the organization) the
// only one you belong to, or a question in a terminal. Nothing is remembered between
// runs, so a command never acts on something you did not name this time.
catalogInfo.flag("org", { env: "SALEOR_ORG" });

catalogInfo.flag("project", { env: "SALEOR_PROJECT" });

catalogInfo.flag("env", { env: "SALEOR_ENV" });

export const orgFlag = Flag.String("org").pipe(
  Flag.withMetavar("slug"),
  Flag.withDescription(
    "Organization to use. Defaults to SALEOR_ORG, then your only organization."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_ORG")),
  Flag.optional
);

export const projectFlag = Flag.String("project").pipe(
  Flag.withMetavar("project"),
  Flag.withDescription("Project slug or name. Defaults to SALEOR_PROJECT."),
  Flag.withFallbackConfig(Config.String("SALEOR_PROJECT")),
  Flag.optional
);

export const envFlag = Flag.String("env").pipe(
  Flag.withMetavar("env"),
  Flag.withDescription("Environment name or key. Defaults to SALEOR_ENV."),
  Flag.withFallbackConfig(Config.String("SALEOR_ENV")),
  Flag.optional
);

const chooseOrganization = (flag: Option.Option<string>, allowInput: boolean) =>
  Effect.gen(function* () {
    if (Option.isSome(flag)) {
      return flag.value;
    }

    const organizations = yield* listOrganizations;
    const slugs = organizations.map((org) => org.slug);
    const [only] = slugs;

    if (slugs.length === 1 && only !== undefined) {
      return only;
    }

    if (allowInput && slugs.length > 1 && (yield* isInteractive)) {
      return yield* pickOrganization();
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
            suggestion: "Pass --org <slug> or set SALEOR_ORG.",
          }
        );
  });

export interface Scope {
  readonly environment: Option.Option<string>;
  readonly organization: string;
  readonly project: Option.Option<string>;
}

export interface ScopeInput {
  readonly dryRun?: boolean;
  readonly env?: Option.Option<string>;
  readonly org: Option.Option<string>;
  readonly project?: Option.Option<string>;
}

// Resolves the organization; the project and environment are only what was passed.
export const resolveScope = (input: ScopeInput) =>
  Effect.gen(function* () {
    if (!input.dryRun) {
      yield* ensureSignedIn;
    }

    const scope: Scope = {
      environment: input.env ?? Option.none(),
      organization: yield* chooseOrganization(input.org, !input.dryRun),
      project: input.project ?? Option.none(),
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
            ? "Pass --project <project> or set SALEOR_PROJECT."
            : "Pass the environment name or key, or set SALEOR_ENV.",
      }),
    onSome: Effect.succeed,
  });
