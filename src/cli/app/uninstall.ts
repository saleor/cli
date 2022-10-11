import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { doSaleorAppDelete } from '../../lib/common.js';
import { obfuscateArgv, print, println } from '../../lib/util.js';
import { useAppConfig, useInstanceConnector } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:uninstall');

export const command = 'uninstall [app]';
export const desc = 'Uninstall a Saleor App by name';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  print(`Uninstalling ${argv.app} the Saleor App from your Dashboard...`);
  const r = await doSaleorAppDelete(argv);

  if (r.length > 0) {
    println(` ${chalk.red('fail')}`);
    console.error(r);

    process.exit(1);
  } else {
    println(` ${chalk.green('success')}`);
  }
};

export const middlewares = [useAppConfig, useInstanceConnector];
