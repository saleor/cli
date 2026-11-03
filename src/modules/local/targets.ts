import { target } from "../../core/target.ts";
import { nameProblem } from "./state.ts";

// The name `init --local --name` gives a new instance. A local store has no
// environment variable: there is no ambient local context.
export const instance = target({
  check: nameProblem,
  identifiedBy: "name",
  metavar: "name",
  name: "name",
  noun: "local store",
});
