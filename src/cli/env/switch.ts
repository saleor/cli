import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { obfuscateArgv, promptEnvironment } from '../../lib/util.js';

type Options = {
  key?: string;
};

const debug = Debug('saleor-cli:env:switch');

export const command = 'switch [key|environment]';
export const desc = 'Make the provided environment the default one';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const environment = await getEnvironment(argv);

  await Config.set('environment_id', environment.value);
  console.log(
    chalk.green('✔'),
    chalk.bold('Environment ·'),
    chalk.cyan(environment.value)
  );
};

const getEnvironment = async (argv: Arguments<Options>) => {
  if (argv.environment) {
    return { name: argv.key, value: argv.key };
  }

  const data = await promptEnvironment(argv);

  return data;
};
