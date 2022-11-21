import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { obfuscateArgv, waitForTask } from '../../lib/util.js';
import { useBlockingTasksChecker } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:populate');

export const command = 'populate <key|environment>';
export const desc = 'Populate database for environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const result = (await GET(API.PopulateDatabase, argv)) as any;
  await waitForTask(
    argv,
    result.task_id,
    `Populating database: ${argv.environment}`,
    'Yay! Database populated!'
  );
};

export const middlewares = [useBlockingTasksChecker];
