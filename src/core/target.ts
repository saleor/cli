import { Config, Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import { type CliFailure, fail } from "./errors.ts";
import { readLinkSection, writeLinkSection } from "./link.ts";

export interface SaleorCredentials {
  readonly token: string;
}

export interface Target {
  readonly credentials: Effect.Effect<SaleorCredentials, CliFailure>;
  readonly dashboardUrl: string | null;
  readonly graphqlUrl: string;
  readonly kind: string;
  readonly name: string;
  readonly ref: string;
  readonly saleorVersion: string | null;
}

// Providers close over their own services. Core and consumers never import a module.
export interface TargetProvider {
  readonly kind: string;
  readonly resolve: (ref: string) => Effect.Effect<Target, CliFailure>;
}

export const collectTargetProviders = (
  modules: readonly { readonly target?: TargetProvider }[]
) => {
  const providers = new Map<string, TargetProvider>();

  for (const module of modules) {
    if (module.target) {
      if (providers.has(module.target.kind)) {
        throw new Error(`Duplicate target provider: ${module.target.kind}`);
      }

      providers.set(module.target.kind, module.target);
    }
  }

  return providers;
};

const LegacyCloudLink = Schema.Struct({
  environment: Schema.optionalKey(Schema.String),
  organization: Schema.optionalKey(Schema.String),
  project: Schema.optionalKey(Schema.String),
});

export const readTargetRef = (cwd?: string) =>
  Effect.gen(function* () {
    const target = yield* readLinkSection("target", Schema.String, cwd);

    if (target.value !== undefined) {
      return target.value;
    }

    const legacy = yield* readLinkSection("cloud", LegacyCloudLink, cwd);
    const link = legacy.value;

    return link?.organization && link.project && link.environment
      ? `cloud:${link.organization}/${link.project}/${link.environment}`
      : undefined;
  });

export const writeTargetRef = (ref: string, cwd?: string) =>
  writeLinkSection("target", ref, cwd);

export const targetFlag = Flag.String("target").pipe(
  Flag.withMetavar("ref"),
  Flag.withDescription(
    "Target to use. Defaults to SALEOR_TARGET, then this directory's link."
  ),
  Flag.withFallbackConfig(Config.String("SALEOR_TARGET")),
  Flag.optional
);

export const resolveTarget = (
  providers: ReadonlyMap<string, TargetProvider>,
  explicit: Option.Option<string> = Option.none(),
  cwd?: string
) =>
  Effect.gen(function* () {
    const ref =
      Option.getOrUndefined(explicit) ??
      process.env.SALEOR_TARGET ??
      (yield* readTargetRef(cwd));

    if (ref === undefined) {
      return yield* fail("CONTEXT_MISSING", "No Saleor target selected.", {
        suggestion:
          "Pass --target <ref>, or link this directory: saleor link local:default",
      });
    }

    const kind = ref === "local" ? "local" : ref.split(":")[0];
    const provider = kind === undefined ? undefined : providers.get(kind);

    if (provider === undefined) {
      return yield* fail("USAGE_ERROR", `Unknown target "${ref}".`, {
        suggestion: "Use local:<name> or cloud:<org>/<project>/<environment>.",
      });
    }

    return yield* provider.resolve(ref);
  });

export const targetData = ({ credentials: _, ...data }: Target) => data;
