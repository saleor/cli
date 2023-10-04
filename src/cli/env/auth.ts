import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import Enquirer from 'enquirer';
import { API, PATCH } from '../../lib/index.js';
import {
  obfuscateArgv,
  println,
  printlnSuccess,
  validateLength,
} from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { Options } from '../../types.js';
import { getEnvironment } from '../../lib/environment.js';

const debug = Debug('saleor-cli:env:auth');

export const command = 'auth [key|environment]';
export const desc = 'Manage basic auth for a specific environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  })
    .option('login', {
      type: 'string',
      demandOption: false,
      desc: 'basic auth login of the environment',
    })
    .option('password', {
      alias: 'pass',
      type: 'string',
      demandOption: false,
      desc: 'basic auth password of the environment',
    })
    .option('disable', {
      type: 'boolean',
      demandOption: false,
      desc: 'disable basic auth for the environment',
    })
    .example('saleor env auth', '')
    .example('saleor env auth my-environment', '')
    .example(
      'saleor env auth my-environment --login=saleor --password=saleor',
      '',
    )
    .example('saleor env auth my-environment --disable', '');

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const environment = await getEnvironment(argv);

  if (argv.disable) {
    if (!environment.protected) {
      println('Basic auth is already disabled for this environment');
      return;
    }

    await PATCH(API.Environment, argv, {
      json: {
        login: null,
        password: null,
      },
    });

    printlnSuccess('Basic auth is disabled');
    return;
  }

  const json = await Enquirer.prompt<{
    login: string;
    password: string;
  }>([
    {
      type: 'input',
      name: 'login',
      message: 'Login',
      initial: argv.login,
      skip: !!argv.login,
      validate: (value) => validateLength(value, 127, 'login', true),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
      initial: argv.password,
      skip: !!argv.password,
      validate: (value) => validateLength(value, 127, 'password', true),
    },
  ]);

  await PATCH(API.Environment, argv, {
    json,
  });

  printlnSuccess('Basic auth is enabled');
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
