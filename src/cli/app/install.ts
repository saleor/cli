import { CliUx } from '@oclif/core';
import Enquirer from 'enquirer';
import got from 'got';
import { Arguments } from 'yargs';
import { AppInstall } from '../../graphql/AppInstall.js';
import { doSaleorAppInstall } from '../../lib/common.js';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { printContext } from '../../lib/util.js';
import { Options } from '../../types.js';

export const command = "install";
export const desc = "Install a Saleor App by URL";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment)

  await doSaleorAppInstall(argv)

  process.exit(0);
};
