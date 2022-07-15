import chalk from 'chalk';
import Enquirer from 'enquirer';
import got from 'got';
import { request } from 'graphql-request';
import type { Arguments, CommandBuilder } from 'yargs';

import {
  GetWebhookAsyncEventEnum,
  GetWebhookSyncEventEnum,
} from '../../generated/graphql.js';
import { doWebhookCreate } from '../../graphql/doWebhookCreate.js';
import { Config } from '../../lib/config.js';
import { API, DefaultSaleorEndpoint, GET } from '../../lib/index.js';
import { without } from '../../lib/util.js';
import { interactiveSaleorApp } from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'create';
export const desc = 'Create a new webhook';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const { environment, app } = argv;
  const {
    __type: { enumValues: asyncEventsList },
  } = await request(DefaultSaleorEndpoint, GetWebhookAsyncEventEnum);
  const asyncEventsListChoices = asyncEventsList.filter(without('ANY_EVENTS'));

  const {
    __type: { enumValues: syncEventsList },
  } = await request(DefaultSaleorEndpoint, GetWebhookSyncEventEnum);

  console.log(`Creating a webhook for the ${environment} environment`);

  const {
    name,
    targetUrl,
    secretKey,
    asyncEvents,
    syncEvents,
    isActive,
    query,
  } = await Enquirer.prompt<{
    name: string;
    targetUrl: string;
    secretKey: string;
    asyncEvents: string[];
    syncEvents: string[];
    isActive: boolean;
    query: string;
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
      skip: !!argv.targetUrl,
    },
    {
      type: 'input',
      name: 'secretKey',
      message: 'Secret',
      initial: argv.secretKey,
      skip: !!argv.secretKey,
    },
    {
      type: 'multiselect',
      name: 'asyncEvents',
      message: 'Select asynchronous events',
      choices: asyncEventsListChoices,
    },
    {
      type: 'multiselect',
      name: 'syncEvents',
      message: 'Selec synchronous events',
      choices: syncEventsList,
    },
    {
      type: 'confirm',
      name: 'isActive',
      message: 'Webhook is active',
      format: (value) => chalk.cyan(value ? 'yes' : 'no'),
      initial: true,
    },
    {
      type: 'input',
      name: 'query',
      message: 'Subscription query',
    },
  ]);

  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const { data }: any = await got
    .post(`https://${domain}/graphql`, {
      headers,
      json: {
        query: doWebhookCreate,
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
    webhookCreate: {
      webhook: { id },
    },
  } = data;
  console.log(chalk('Webhook created with id', chalk.green(id)));
};

export const middlewares = [interactiveSaleorApp];
