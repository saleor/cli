import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { doSaleorAppDelete } from '../../lib/common.js';
import { printContext } from '../../lib/util.js';
import { useAppConfig, useInstanceConnector } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:uninstall');

export const command = 'uninstall [app]';
export const desc = 'Uninstall a Saleor App by name';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', argv);

  const { organization, environment } = argv;

  printContext(organization, environment);

  process.stdout.write(
    `Uninstalling ${argv.app} the Saleor App from your Dashboard...`
  );
  await doSaleorAppDelete(argv);
  console.log(` ${chalk.green('success')}`);

  process.exit(0);
};

export const middlewares = [useAppConfig, useInstanceConnector];
