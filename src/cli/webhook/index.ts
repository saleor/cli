import * as list from "./list.js";
import * as create from "./create.js";
import * as edit from "./edit.js";
import { useEnvironment, useOrganization, useToken } from "../../middleware/index.js";

export default function (_: any) {
  _.command([
    list,
    create,
    edit,
  ])
  .middleware([useToken, useOrganization, useEnvironment])
  .demandCommand(1, "You need at least one command before moving on");
}