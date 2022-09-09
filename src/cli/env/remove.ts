import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { API, DELETE, GET } from '../../lib/index.js';
import { confirmRemoval, waitForTask } from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';
import { Options, Task } from '../../types.js';

const debug = Debug('saleor-cli:env:remove');

export const command = 'remove [key|environment]';
export const desc = 'Delete an environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  }).option('force', {
    type: 'boolean',
    desc: 'skip confirmation prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', argv);

  const { environment } = argv;

  const proceed = await confirmRemoval(argv, `environment ${environment}`);

  if (proceed && environment) {
    const result = (await DELETE(API.Environment, {
      ...argv,
      ...{ environment },
    })) as Task;
    await waitForTask(
      argv,
      result.task_id,
      `Deleting environment: ${environment}`,
      'Yay! Environment deleted!'
    );
    await removeCurrentEnvironment(environment);
  }
};

const removeCurrentEnvironment = async (environment: string) => {
  const { environment_id: current } = await Config.get();

  if (environment === current) {
    await Config.remove('environment_id');
    console.log(
      'Default environment unset. Use ',
      chalk.bold('saleor environment switch'),
      ' to choose default one'
    );
  }
};

export const middlewares = [useEnvironment];
