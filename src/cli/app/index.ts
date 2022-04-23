import * as list from "./list.js";
import * as install from "./install.js";
import * as tunnel from "./tunnel.js";
import * as create from "./create.js";
import { useEnvironment, useOrganization, useToken } from "../../middleware/index.js";
import fs from 'fs-extra';
import { NotSaleorAppDirectoryError } from "../../lib/util.js";

export default function (_: any) {
  _.command([
    list,
    install,
    tunnel,
    create,
  ])
  .middleware([verifyIsSaleorAppDirectory, useToken, useOrganization, useEnvironment])
  .demandCommand(1, "You need at least one command before moving on");
}

export const verifyIsSaleorAppDirectory = async (argv: any) => {
  const isTunnel = argv._[1] === 'tunnel';
  // check if this is a Next.js app
  const isNodeApp = await fs.pathExists('package.json')
  const isNextApp = await fs.pathExists('next.config.js')
  const hasDotEnvFile = await fs.pathExists('.env')

  if (! isTunnel) {
    return {}
  }

  if (!isNextApp || !isNodeApp || !hasDotEnvFile) {
    throw new NotSaleorAppDirectoryError("`app tunnel` must be run from the directory of your Saleor app");
  }

  return {};
};
