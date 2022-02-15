import * as show from "./show.js";
import * as list from "./list.js";
import * as create from "./create.js";
import * as remove from "./remove.js";
import * as cleardb from "./clear.js";
import * as upgrade from "./upgrade.js";
import * as populatedb from "./populate.js";

export default function (_: any) {
  _.command([
    show,
    list,
    create,
    remove,
    upgrade,
    cleardb,
    populatedb
  ]).demandCommand(1, "You need at least one command before moving on");
}
