import * as list from "./list.js";

export default function (_: any) {
  _.command([
    list,
  ]).demandCommand(1, "You need at least one command before moving on");
}
