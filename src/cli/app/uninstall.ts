import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { doSaleorAppDelete } from '../../lib/common.js';
import {
  obfuscateArgv,
  println,
  SaleorAppUninstallError,
} from '../../lib/util.js';
import {
  useAppConfig,
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:uninstall');

export const command = 'uninstall <app-id>';
export const desc =
  'Uninstall a Saleor App by ID. You need to provide `appId`. List available apps and their IDs with `saleor app list`.';

export const builder: CommandBuilder = (_) =>
  _.positional('app-id', {
    type: 'string',
    demandOption: false,
    desc: 'The Saleor App id',
  })

    .example('saleor app uninstall app-id', '')
    .example(
      'saleor app uninstall app-id --organization=organization-slug --environment=env-id-or-name',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  println(`\nUninstalling ${argv.appId} the Saleor App from your Dashboard...`);

  const r = await doSaleorAppDelete(argv);

  if (r.length > 0) {
    throw new SaleorAppUninstallError(JSON.stringify(r));
  } else {
    println(chalk.green('Success'));
  }
};

export const middlewares = [
  useAppConfig,
  useInstanceConnector,
  useAvailabilityChecker,
];
