import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { confirmRemoval, obfuscateArgv, waitForTask } from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:populate');

export const command = 'populate [key|environment]';
export const desc = 'Populate database for environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { environment } = argv;

  const proceed = await confirmRemoval(
    argv,
    `environment ${environment}`,
    'replace database with a sample for'
  );

  if (proceed) {
    const result = (await GET(API.PopulateDatabase, argv)) as any;
    await waitForTask(
      argv,
      result.task_id,
      `Populating database: ${argv.environment}`,
      'Yay! Database populated!'
    );
  }
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
