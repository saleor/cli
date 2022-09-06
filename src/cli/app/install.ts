import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { doSaleorAppInstall } from '../../lib/common.js';
import { printContext } from '../../lib/util.js';
import {
  useEnvironment,
  useOrganization,
  useToken,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:install');

export const command = 'install';
export const desc = 'Install a Saleor App by URL';

export const builder: CommandBuilder = (_) =>
  _.option('via-dashboard', {
    type: 'boolean',
    default: false,
  });

export const handler = async (argv: Arguments<Options>) => {
  debug(`command arguments: ${JSON.stringify(argv, null, 2)}`);

  const { organization, environment } = argv;

  printContext(organization, environment);

  await doSaleorAppInstall(argv);

  process.exit(0);
};

export const middlewares = [useToken, useOrganization, useEnvironment];
