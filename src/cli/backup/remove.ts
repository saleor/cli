import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, DELETE } from '../../lib/index.js';
import {
  confirmRemoval,
  obfuscateArgv,
  printlnSuccess,
} from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:backup:remove');

export const command = 'remove <key|backup>';
export const desc = 'Remove the backup';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the backup',
  })
    .option('force', {
      type: 'boolean',
      desc: 'skip confirmation prompt',
    })
    .example('saleor backup remove', '')
    .example('saleor backup remove backup-key --force', '')
    .example(
      'saleor backup remove backup-key --force --organization="organization-slug" --environment="env-id-or-name"',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const proceed = await confirmRemoval(argv, `backup ${argv.key}`);

  if (proceed) {
    (await DELETE(API.Backup, {
      ...argv,
    })) as any;

    printlnSuccess(chalk.bold('Backup has been successfully removed'));
  }
};
