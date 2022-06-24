import { Arguments } from "yargs";
import { doSaleorAppInstall } from "../../lib/common.js";

import { printContext } from "../../lib/util.js";
import {
  useEnvironment,
  useOrganization,
  useToken,
} from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "install";
export const desc = "Install a Saleor App by URL";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment);

  await doSaleorAppInstall(argv);

  process.exit(0);
};

export const middlewares = [useToken, useOrganization, useEnvironment];
