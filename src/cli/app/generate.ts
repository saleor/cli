// FIXME
/* eslint-disable no-case-declarations */
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { CommandRemovedError, obfuscateArgv } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:generate');

export const command = 'generate <resource>';
export const desc = false;
// export const desc = 'Generate a resource for a Saleor App';

export const builder: CommandBuilder = (_) =>
  _.positional('resource', {
    type: 'string',
    demandOption: true,
    choices: ['webhook', 'query', 'mutation', 'subscription'],
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  throw new CommandRemovedError(
    'This command has been removed\nPlease check documentation for `app` commands at https://github.com/saleor/saleor-cli/tree/main/docs',
  );
};

// export const middlewares = [verifyIsSaleorAppDirectory];
