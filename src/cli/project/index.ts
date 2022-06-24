import { useOrganization, useToken } from "../../middleware/index.js";
import * as create from "./create.js";
import * as list from "./list.js";
import * as remove from "./remove.js";
import * as show from "./show.js";

export default function (_: any) {
  _.command([list, create, remove, show])
    .middleware([useToken, useOrganization])
    .demandCommand(1, "You need at least one command before moving on");
}
