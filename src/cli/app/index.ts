import * as list from "./list.js";
import * as install from "./install.js";
import * as start from "./start.js";
import * as create from "./create.js";
import { useEnvironment, useOrganization, useToken } from "../../middleware/index.js";

export default function (_: any) {
  _.command([
    list,
    install,
    start,
    create,
  ])
  .middleware([useToken, useOrganization, useEnvironment])
  .demandCommand(1, "You need at least one command before moving on");
}
