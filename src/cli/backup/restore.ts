import Debug from 'debug';
import Enquirer from 'enquirer';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, PUT } from '../../lib/index.js';
import {
  obfuscateArgv,
  promptOrganizationBackup,
  waitForTask,
} from '../../lib/util.js';
import { Options } from '../../types.js';
import { updateWebhook } from '../webhook/update.js';
import {
  useBlockingTasksChecker,
  useInstanceConnector,
} from '../../middleware/index.js';

const debug = Debug('saleor-cli:backup:restore');

export const command = 'restore [from]';
export const desc = 'Restore a specific backup';

export const builder: CommandBuilder = (_) =>
  _.option('from', {
    type: 'string',
    demandOption: false,
    desc: 'the key of the snapshot',
  })
    .option('skip-webhooks-update', {
      type: 'boolean',
      demandOption: false,
      desc: 'skip webhooks update prompt',
    })
    .example('saleor backup restore', '')
    .example(
      'saleor backup restore --from="backup-key" --skip-webhooks-update',
      '',
    )
    .example(
      'saleor backup restore --from="backup-key" --skip-webhooks-update --organization="organization-slug" --environment="env-id-or-name"',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

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
    'Yay! Restore finished!',
  );

  const { update } = await Enquirer.prompt<{ update: string }>({
    type: 'confirm',
    name: 'update',
    skip: !!argv.skipWebhooksUpdate,
    message: 'Would you like to update webhooks targetUrl',
  });

  if (update) {
    const { instance } = argv;
    await updateWebhook(instance!, argv.json);
  }
};

const getBackup = async (argv: Arguments<Options>) => {
  if (argv.from) {
    return { key: argv.from, value: argv.from };
  }

  const data = await promptOrganizationBackup(argv);

  return data;
};

export const middlewares = [useInstanceConnector, useBlockingTasksChecker];
