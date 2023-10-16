import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import Enquirer from 'enquirer';
import { API, PATCH } from '../../lib/index.js';
import { obfuscateArgv, printlnSuccess } from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { Options } from '../../types.js';
import { getEnvironment, promptOrigin } from '../../lib/environment.js';

const debug = Debug('saleor-cli:env:auth');

export const command = 'origins [key|environment]';
export const desc = 'Manage the environment\'s trusted client origins';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  })
    .option('origins', {
      type: 'array',
      demandOption: false,
      desc: 'Allowed domains',
    })
    .example('saleor env origins', '')
    .example(
      'saleor env origins my-environment --origins=https://trusted-origin.com',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { allowed_client_origins: allowedClientOrigins } =
    await getEnvironment(argv);

  if (((argv.origins as undefined | string[]) || [])?.length > 0) {
    await PATCH(API.Environment, argv, {
      json: {
        allowed_client_origins: argv.origins,
      },
    });

    printlnSuccess('Specified trusted origins are allowed');
    return;
  }

  const selected: string[] = (allowedClientOrigins as string[]) || [];
  let addMore = true;

  const { origins } = await Enquirer.prompt<{
    origins: string;
  }>([
    {
      type: 'multiselect',
      name: 'origins',
      message:
        'Define Trusted Origins\n (use the arrows to navigate and the space bar to select)',
      choices: [...selected, 'Add a new trusted origin'],
      initial: selected,
    },
  ]);

  do {
    if (origins.length === 0) {
      return;
    }
    if (origins.includes('Add a new trusted origin')) {
      const form = await promptOrigin();
      selected.push(form.origin);
      addMore = form.addMore;
    } else {
      addMore = false;
    }
  } while (addMore);

  const { proceed } = await Enquirer.prompt<{
    proceed: boolean;
  }>([
    {
      type: 'confirm',
      name: 'proceed',
      message: `Do you want to set the following trusted origins?\n    ${selected.join(
        '\n    ',
      )}`,
    },
  ]);

  if (proceed) {
    await PATCH(API.Environment, argv, {
      json: {
        allowed_client_origins: selected,
      },
    });

    printlnSuccess('Specified trusted origins are allowed');
  }
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
