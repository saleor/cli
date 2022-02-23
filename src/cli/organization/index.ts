import * as show from "./show.js";
import * as list from "./list.js";
import * as create from "./create.js";
import * as remove from "./remove.js";
import * as permissions from "./permissions.js";
import * as change from "./switch.js";
import { useDefault } from "../../middleware/index.js";

export default function (_: any) {
  _.command([
    show,
    list,
    create,
    remove,
    permissions,
    change
  ])
  .middleware(useDefault)
  .demandCommand(1, "You need at least one command before moving on");
}
