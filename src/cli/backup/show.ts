import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET, NoCommandBuilderSetup } from '../../lib/index.js';
import { obfuscateArgv, showResult } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:backup:show');

export const command = 'show [backup|backup-key]';
export const desc = 'Show a specific backup';

export const builder: CommandBuilder = NoCommandBuilderSetup;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const result = (await GET(API.Backup, argv)) as any;
  showResult(result, argv);
};
