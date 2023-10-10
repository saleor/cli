import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import Enquirer from 'enquirer';
import { ar } from 'date-fns/locale';
import { error } from 'console';
import chalk from 'chalk';
import { API, PATCH } from '../../lib/index.js';
import { obfuscateArgv, println, printlnSuccess } from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { Options } from '../../types.js';
import { getEnvironment, promptOrigin } from '../../lib/environment.js';

const debug = Debug('saleor-cli:env:auth');

export const command = 'cors [key|environment]';
export const desc = 'Manage environment\'s CORS';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  })
    .option('all', {
      type: 'boolean',
      demandOption: false,
      desc: 'All origins are allowed',
    })
    .option('dashboard', {
      type: 'boolean',
      demandOption: false,
      desc: 'Only dashboard is allowed',
    })
    .option('selected', {
      type: 'array',
      demandOption: false,
      desc: 'Only specified origins are allowed',
    })
    .example('saleor env cors', '')
    .example('saleor env cors my-environment --all', '')
    .example('saleor env cors my-environment --dashboard', '')
    .example(
      'saleor env cors my-environment --selected="https://example.com"',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { allowed_cors_origins: allowedCorsOrigins } =
    await getEnvironment(argv);

  if (argv.all) {
    if (allowedCorsOrigins === '*') {
      println('All origins are already allowed');
      return;
    }

    await PATCH(API.Environment, argv, {
      json: {
        allowed_cors_origins: '*',
      },
    });

    printlnSuccess('All origins are allowed');
    return;
  }

  if (argv.dashboard) {
    if (!allowedCorsOrigins) {
      println('Only dashboard is already allowed');
      return;
    }

    await PATCH(API.Environment, argv, {
      json: {
        allowed_cors_origins: null,
      },
    });

    printlnSuccess('Only dashboard is allowed');
    return;
  }

  if (((argv.selected as undefined | string[]) || []).length > 0) {
    await PATCH(API.Environment, argv, {
      json: {
        allowed_cors_origins: argv.selected,
      },
    });

    printlnSuccess('Selected Origins are allowed');
    return;
  }

  // First form to check current
  const { kind } = await Enquirer.prompt<{
    kind: string;
  }>([
    {
      type: 'select',
      name: 'kind',
      message: 'Choose allowed API origins ',
      choices: [
        {
          name: 'Allow all origins',
          value: 'all',
        },
        {
          name: 'Selected Origins',
          value: 'selected',
        },
        {
          name: 'Dashboard only',
          value: 'dashboard',
        },
      ],
      initial: () => {
        if (allowedCorsOrigins === '*') {
          return 1;
        }
        if (allowedCorsOrigins == null) {
          return 2;
        }
        if (Array.isArray(allowedCorsOrigins)) {
          return 3;
        }

        return 1;
      },
    },
  ]);

  // Trigger an update for all and dashboard
  if (['all', 'dashboard'].includes(kind)) {
    await PATCH(API.Environment, argv, {
      json: {
        allowed_cors_origins: kind === 'all' ? '*' : null,
      },
    });

    printlnSuccess(
      kind === 'all' ? 'All origins are allowed' : 'Only dashboard is allowed',
    );
    return;
  }

  // Handle selected origins
  const selected: string[] =
    (argv.selected as string[]) || (allowedCorsOrigins as string[]) || [];
  let addMore = true;

  const { origins } = await Enquirer.prompt<{
    origins: string;
  }>([
    {
      type: 'multiselect',
      name: 'origins',
      message:
        'Define Selected Origins\n (use the arrows to navigate and the space bar to select)',
      choices: [...selected, 'Add a new origin'],
      initial: selected,
    },
  ]);

  do {
    if (origins.length === 0) {
      return;
    }
    if (origins.includes('Add a new CORS origin')) {
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
      message: `Do you want to set the following CORS origins?\n    ${selected.join(
        '\n    ',
      )}`,
    },
  ]);

  if (proceed) {
    await PATCH(API.Environment, argv, {
      json: {
        allowed_cors_origins: selected,
      },
    });

    printlnSuccess('Specified CORS origins are allowed');
  }
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
