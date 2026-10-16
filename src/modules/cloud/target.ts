import { Effect } from "effect";
import { fail } from "../../core/errors.ts";
import type { Target } from "../../core/target.ts";
import { describeEnvironment, requireEnvironment } from "./lookup.ts";

export const resolveCloudTarget = (ref: string) =>
  Effect.gen(function* () {
    const parts = ref.startsWith("cloud:") ? ref.slice(6).split("/") : [];
    const [organization, project, environment] = parts;

    if (parts.length !== 3 || !organization || !project || !environment) {
      return yield* fail("USAGE_ERROR", `Invalid Cloud target "${ref}".`, {
        suggestion: "Use cloud:<org>/<project>/<environment>.",
      });
    }

    const found = yield* requireEnvironment(organization, environment, project);
    const details = describeEnvironment(organization, found);

    const target: Target = {
      credentials: Effect.fail(
        fail(
          "TARGET_CREDENTIALS_REQUIRED",
          "Saleor Cloud login does not grant access to the store's GraphQL API.",
          {
            suggestion:
              "Create a staff or app token in the store Dashboard. Cloud token exchange is not available yet.",
          }
        )
      ),
      dashboardUrl: details.dashboardUrl,
      graphqlUrl: details.graphqlUrl,
      kind: "cloud",
      name: found.name,
      ref: `cloud:${organization}/${found.project.slug}/${found.key}`,
      saleorVersion: details.saleorVersion,
    };

    return target;
  });
