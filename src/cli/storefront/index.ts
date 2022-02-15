import * as deploy from "./deploy.js";

export default function (_: any) {
  _.command([
    deploy,
  ]).demandCommand(1, "You need at least one command before moving on");
}
