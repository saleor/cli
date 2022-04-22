import * as list from "./list.js";
import * as install from "./install.js";
import * as tunnel from "./tunnel.js";
import * as create from "./create.js";
import { useEnvironment, useOrganization, useToken } from "../../middleware/index.js";

export default function (_: any) {
  _.command([
    list,
    install,
    tunnel,
    create,
  ])
  .middleware([useToken, useOrganization, useEnvironment])
  .demandCommand(1, "You need at least one command before moving on");
}
