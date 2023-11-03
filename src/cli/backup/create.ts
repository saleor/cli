import Debug from 'debug';
import Enquirer from 'enquirer';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, POST } from '../../lib/index.js';
import {
  obfuscateArgv,
  showResult,
  validateLength,
  waitForTask,
} from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';

const debug = Debug('saleor-cli:backup:create');

export const command = 'create [name]';
export const desc = 'Create a new backup';

export const builder: CommandBuilder = (_) =>
  _.option('name', {
    type: 'string',
    demandOption: false,
    desc: 'name for the new backup',
  })
    .example('saleor backup create', '')
    .example(
      'saleor backup create my-backup --organization="organization-slug"',
      '',
    );

export const handler = async (argv: Arguments<any>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { name } = (await Enquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Backup name',
      initial: argv.name,
      required: true,
      skip: !!argv.name,
      validate: (value) => validateLength(value, 255),
    },
  ])) as { name: string };

  debug(`Using the name: ${name}`);

  const result = (await POST(API.EnvironmentBackup, argv, {
    json: {
      name,
    },
  })) as any;
  debug('Backup creation triggered');

  await waitForTask(
    argv,
    result.task_id,
    `Creating backup ${name}`,
    'Yay! Backup created!',
  );
  showResult(result, argv);
};

export const middlewares = [useEnvironment];
