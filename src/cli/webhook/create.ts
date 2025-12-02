import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import { request } from 'graphql-request';
import type { Arguments, CommandBuilder } from 'yargs';

import {
  GetWebhookAsyncEventEnum,
  GetWebhookSyncEventEnum,
  WebhookCreate,
} from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { DefaultSaleorEndpoint } from '../../lib/index.js';
import {
  formatConfirm,
  obfuscateArgv,
  println,
  validateURL,
  without,
} from '../../lib/util.js';
import { interactiveSaleorApp } from '../../middleware/index.js';
import { Options, WebhookError } from '../../types.js';

const debug = Debug('saleor-cli:webhook:create');

export const command = 'create';
export const desc = 'Create a new webhook';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { environment, app } = argv;
  const {
    __type: { enumValues: asyncEventsList },
  } = await request<any>(DefaultSaleorEndpoint, GetWebhookAsyncEventEnum);
  const asyncEventsListChoices = asyncEventsList.filter(without('ANY_EVENTS'));

  const {
    __type: { enumValues: syncEventsList },
  } = await request<any>(DefaultSaleorEndpoint, GetWebhookSyncEventEnum);

  println(`Creating a webhook for the ${environment} environment`);

  const { name, targetUrl, secretKey, asyncEvents } = await Enquirer.prompt<{
    name: string;
    targetUrl: string;
    secretKey: string;
    asyncEvents: string[];
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Name',
      initial: argv.name,
      required: true,
      skip: !!argv.name,
    },
    {
      type: 'input',
      name: 'targetUrl',
      message: 'Target URL',
      initial: argv.targetUrl,
      required: true,
      validate: (value) => validateURL(value),
      skip: !!argv.targetUrl,
    },
    {
      type: 'input',
      name: 'secretKey',
      message: 'Secret (optional)',
      initial: argv.secretKey,
      skip: !!argv.secretKey,
    },
    {
      type: 'multiselect',
      name: 'asyncEvents',
      message:
        'Select asynchronous events\n  (use the arrows to navigate and the space bar to select)',
      choices: asyncEventsListChoices,
    },
  ]);

  // https://github.com/enquirer/enquirer/issues/298
  let syncEvents: string[] = [];
  if (asyncEvents.length === 0) {
    const { events } = await Enquirer.prompt<{
      events: string[];
    }>({
      type: 'multiselect',
      name: 'syncEvents',
      message:
        'Select synchronous events\n  (use the arrows to navigate and the space bar to select)',
      choices: syncEventsList,
    });

    syncEvents = events;
  }

  const { query, isActive } = await Enquirer.prompt<{
    query: string;
    isActive: boolean;
  }>([
    {
      type: 'input',
      name: 'query',
      message: 'Subscription query (optional)',
    },
    {
      type: 'confirm',
      name: 'isActive',
      message: 'Webhook is active',
      format: formatConfirm,
      initial: true,
    },
  ]);

  const { instance } = argv;
  const headers = await Config.getBearerHeader();

  const { data }: any = await got
    .post(instance!, {
      headers,
      json: {
        query: print(WebhookCreate),
        variables: {
          input: {
            name,
            targetUrl,
            secretKey,
            asyncEvents,
            syncEvents,
            isActive,
            app,
            query,
          },
        },
      },
    })
    .json();

  const {
    webhookCreate: { webhook, errors },
  } = data;

  if (errors.length) {
    throw new Error(
      errors.map((e: WebhookError) => `\n ${e.field} - ${e.message}`).join(),
    );
  }

  println(chalk('Webhook created with id', chalk.green(webhook?.id)));
};

export const middlewares = [interactiveSaleorApp];
