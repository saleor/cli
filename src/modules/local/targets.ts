import { Effect } from "effect";
import { defineActions } from "../../core/action.ts";
import { target } from "../../core/target.ts";
import { listInstanceNames, nameProblem } from "./state.ts";

// Local actions need no login or other module policy.
export const local = defineActions();

// A local instance has no environment variable: there is no ambient local context.
export const instance = target({
  check: nameProblem,
  identifiedBy: "name",
  metavar: "name",
  name: "name",
  noun: "local instance",
});

export const instanceChoices = Effect.map(listInstanceNames(), (names) =>
  names.map((name) => ({ label: name, value: name }))
);

export const noInstancesHint =
  "Create one with: saleor init --local --name <name>";
