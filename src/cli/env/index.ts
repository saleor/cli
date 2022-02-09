import * as show from "./show.js";
import * as list from "./list.js";

export default function (_: any) {
  _.command([
    show,
    list,
    // ...more commands here
  ]).demandCommand(1, "You need at least one command before moving on");
}
