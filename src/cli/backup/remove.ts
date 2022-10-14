import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, DELETE } from '../../lib/index.js';
import { confirmRemoval, obfuscateArgv } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:backup:remove');

export const command = 'remove <key>';
export const desc = 'Remove the backup';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the backup',
  }).option('force', {
    type: 'boolean',
    desc: 'skip confirmation prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const proceed = await confirmRemoval(argv, `backup ${argv.key}`);

  if (proceed) {
    (await DELETE(API.Backup, {
      ...argv,
    })) as any;

    console.log(
      chalk.green('✔'),
      chalk.bold('Backup has been successfully removed')
    );
  }
};
