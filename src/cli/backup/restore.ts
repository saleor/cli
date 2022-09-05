import Debug from 'debug';
import Enquirer from 'enquirer';
import type { Arguments, CommandBuilder } from 'yargs';

import { getEnvironmentGraphqlEndpoint } from '../../lib/environment.js';
import { API, PUT } from '../../lib/index.js';
import { promptOrganizationBackup, waitForTask } from '../../lib/util.js';
import { Options } from '../../types.js';
import { updateWebhook } from '../webhook/update.js';

const debug = Debug('backup:restore');

export const command = 'restore [from]';
export const desc = 'Restore a specific backup';

export const builder: CommandBuilder = (_) =>
  _.option('from', {
    type: 'string',
    demandOption: false,
    desc: 'key of the snapshot',
  }).option('skip-webhooks-update', {
    type: 'boolean',
    demandOption: false,
    desc: 'skip webhooks update prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug(
    `Started with --from=${argv.from} and --skip-webhooks-update=${argv.skipWebhooksUpdate}`
  );

  const from = await getBackup(argv);

  debug('Triggering the restore process');
  const result = (await PUT(API.Restore, argv, {
    json: {
      restore_from: from.value,
    },
  })) as any;

  await waitForTask(
    argv,
    result.task_id,
    'Restoring',
    'Yay! Restore finished!'
  );

  const { update } = await Enquirer.prompt<{ update: string }>({
    type: 'confirm',
    name: 'update',
    skip: !!argv.skipWebhooksUpdate,
    message: 'Would you like to update webhooks targetUrl',
  });

  if (update) {
    const endpoint = await getEnvironmentGraphqlEndpoint(argv);
    debug(`Saleor endpoint: ${endpoint}`);
    await updateWebhook(endpoint);
  }
};

const getBackup = async (argv: Arguments<Options>) => {
  if (argv.from) {
    return { key: argv.from, value: argv.from };
  }

  const data = await promptOrganizationBackup(argv);

  return data;
};
