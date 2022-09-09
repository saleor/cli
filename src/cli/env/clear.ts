import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { waitForTask } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:clear');

export const command = 'clear <key|environment>';
export const desc = 'Clear database for environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', argv);
  debug('sending the request to Saleor API');
  const result = (await GET(API.ClearDatabase, argv)) as any;
  await waitForTask(argv, result.task_id, 'Clearing', 'Yay! Database cleared!');
};
