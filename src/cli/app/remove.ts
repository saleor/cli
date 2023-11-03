import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import { print } from 'graphql';
import type { Arguments, CommandBuilder } from 'yargs';

import { AppDelete } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { confirmRemoval, obfuscateArgv, println } from '../../lib/util.js';
import {
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { WebhookError } from '../../types.js';
import { getSaleorApp } from './token.js';

const debug = Debug('saleor-cli:app:create');

export const command = 'remove [app-id]';
export const desc = 'Create a new Saleor Local App';

export const builder: CommandBuilder = (_) =>
  _.option('app-id', {
    type: 'string',
    demandOption: false,
    desc: 'The Saleor App id',
  })
    .option('force', {
      type: 'boolean',
      desc: 'skip confirmation prompt',
    })
    .example('saleor app remove', '')
    .example(
      'saleor app remove --app-id="app-id" --environment="env-id-or-name" --force',
      '',
    );

export const handler = async (argv: Arguments<any>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { instance, appId, json } = argv;
  const { app } = await getSaleorApp({ instance, appId, json });

  const proceed = await confirmRemoval(argv, `app ${app}`);

  if (proceed && app) {
    const headers = await Config.getBearerHeader();

    const { data }: any = await got
      .post(instance, {
        headers,
        json: {
          query: print(AppDelete),
          variables: {
            app,
          },
        },
      })
      .json();

    const {
      appDelete: { app: _app, errors },
    } = data;

    if (errors.length) {
      throw new Error(
        errors.map((e: WebhookError) => `\n ${e.field} - ${e.message}`).join(),
      );
    }

    println(chalk('App removed ', chalk.green(_app?.name, '-', _app?.id)));
  }
};

export const middlewares = [useInstanceConnector, useAvailabilityChecker];
