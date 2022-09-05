import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET, NoCommandBuilderSetup } from '../../lib/index.js';
import { showResult } from '../../lib/util.js';
import { Options } from '../../types.js';

export const command = 'show [backup]';
export const desc = 'Show a specific backup';

export const builder: CommandBuilder = NoCommandBuilderSetup;

export const handler = async (argv: Arguments<Options>) => {
  const result = (await GET(API.Backup, argv)) as any;
  showResult(result, argv);
};
