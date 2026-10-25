import { defineActions } from "../../core/action.ts";
import { fail } from "../../core/errors.ts";
import { target } from "../../core/target.ts";
import { ensureSignedIn } from "./auth/sign-in.ts";
import { organizationChoices } from "./lookup.ts";

// Every Cloud action offers a login first, when a person is at a terminal.
export const cloud = defineActions({ before: ensureSignedIn });

export const organization = target({
  env: "SALEOR_ORG",
  identifiedBy: "slug",
  metavar: "slug",
  name: "org",
  noun: "organization",
});

export const project = target({
  env: "SALEOR_PROJECT",
  identifiedBy: "slug or name",
  metavar: "project",
  name: "project",
  noun: "project",
});

export const environment = target({
  env: "SALEOR_ENV",
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
