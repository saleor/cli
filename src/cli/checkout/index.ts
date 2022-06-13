import { useEnvironment, useGitub, useOrganization, useToken, useVercel } from "../../middleware/index.js";
import * as deploy from "./deploy.js";

export default function (_: any) {
  _.command([
    deploy,
  ])
    .middleware([useToken, useVercel, useGitub, useOrganization, useEnvironment])
    .demandCommand(1, "You need at least one command before moving on");
}