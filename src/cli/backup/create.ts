import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, POST } from '../../lib/index.js';
import { obfuscateArgv, showResult, waitForTask } from '../../lib/util.js';

const debug = Debug('saleor-cli:backup:create');

export const command = 'create <name>';
export const desc = 'Create a new backup';

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: false,
    desc: 'name for the new backup',
  });

export const handler = async (argv: Arguments<any>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { name } = argv;

  debug(`Using the name: ${name}`);

  const result = (await POST(API.Backup, argv, {
    json: {
      name,
    },
  })) as any;
  debug('Backup creation triggered');

  await waitForTask(
    argv,
    result.task_id,
    `Creating backup ${name}`,
    'Yay! Backup created!'
  );
  showResult(result, argv);
};
