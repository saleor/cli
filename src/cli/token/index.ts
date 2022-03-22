import * as create from "./create.js";

export default function (_: any) {
  _.command([
    create,
  ])
  .demandCommand(1, "You need at least one command before moving on");
}
