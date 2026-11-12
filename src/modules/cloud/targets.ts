import { fail } from "../../core/errors.ts";
import { target } from "../../core/target.ts";
import { organizationChoices } from "./lookup.ts";

export const organization = target({
  env: "SALEOR_ORG",
  identifiedBy: "slug",
  metavar: "slug",
  name: "org",
  noun: "organization",
});

export const cloudProject = target({
  env: "SALEOR_PROJECT",
  identifiedBy: "slug or name",
  metavar: "project",
  name: "project",
  noun: "project",
});

// The name of a new Cloud environment in `init`. SALEOR_ENV is not read here: it names
// the environment a command acts on (see core/env-word.ts), not one to create.
export const cloudEnvironment = target({
  identifiedBy: "name or key",
  metavar: "env",
  name: "env",
  noun: "environment",
});

export const orgInput = organization.input();

// The organization every Cloud command works in. Even the only one is asked for:
// nothing about it is remembered or inferred.
export const organizationOf = (
  supplied: Parameters<typeof orgInput.resolve>[0]
) =>
  orgInput.resolve(supplied, {
    choices: organizationChoices,
    whenEmpty: () =>
      fail(
        "ORGANIZATION_REQUIRED",
        "Your account does not belong to any Saleor Cloud organization.",
        {
          suggestion:
            "Create one at https://cloud.saleor.io, then run this command again.",
        }
      ),
  });
