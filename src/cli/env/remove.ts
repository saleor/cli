import chalk from 'chalk';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { API, DELETE, GET } from '../../lib/index.js';
import { confirmRemoval, waitForTask } from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';
import { Options } from '../../types.js';

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
  const { environment } = argv;

  let env;
  try {
    env = (await GET(API.Environment, argv)) as any;
  } catch (error) {
    const environments = (await GET(API.Environment, {
      ...argv,
      ...{ environment: undefined },
    })) as any;
    const { key } =
      environments.filter(
        ({ name }: { name: string }) => name === environment
      )[0] || {};

    if (key) {
      env = (await GET(API.Environment, {
        ...argv,
        ...{ environment: key },
      })) as any;
    } else {
      throw error;
    }
  }

  const proceed = await confirmRemoval(
    argv,
    `environment ${env.name} - ${env.key}`
  );

  if (proceed && environment) {
    const result = (await DELETE(API.Environment, argv)) as any;
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
