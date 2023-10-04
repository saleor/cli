import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import Enquirer from 'enquirer';
import { getEnvironment } from '../../lib/environment.js';
import { API, PATCH } from '../../lib/index.js';
import {
  obfuscateArgv,
  printlnSuccess,
  validateLength,
} from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:update');

export const command = 'update [key|environment]';
export const desc = 'Update name of the environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  })
    .option('name', {
      type: 'string',
      demandOption: false,
      desc: 'name of the environment',
    })
    .example('saleor env update', '')
    .example('saleor env update my-environment', '')
    .example('saleor env update my-environment --name=renamed-env', '');

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const environment = await getEnvironment(argv);

  const json = await Enquirer.prompt<{
    name: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'name',
      initial: argv.name || environment.name,
      validate: (value) => validateLength(value, 255),
      skip: !!argv.name,
    },
  ]);

  await PATCH(API.Environment, argv, {
    json,
  });

  printlnSuccess('Environment update triggered');
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
