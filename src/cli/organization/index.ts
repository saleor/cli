import { useToken } from "../../middleware/index.js";
import * as list from "./list.js";
import * as permissions from "./permissions.js";
import * as remove from "./remove.js";
import * as show from "./show.js";
import * as change from "./switch.js";

export default function (_: any) {
  _.command([show, list, remove, permissions, change])
    .middleware(useToken)
    .demandCommand(1, "You need at least one command before moving on");
}
