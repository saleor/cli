import chalk from 'chalk';
import Enquirer from 'enquirer';
import got from 'got';
import type { Arguments, CommandBuilder } from 'yargs';

import { doWebhookUpdate } from '../../graphql/doWebhookUpdate.js';
import { Config } from '../../lib/config.js';
import { getEnvironmentGraphqlEndpoint } from '../../lib/environment.js';
import { API, GET } from '../../lib/index.js';
import { validatePresence } from '../../lib/util.js';
import {
  interactiveSaleorApp,
  interactiveWebhook,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'edit';
export const desc = 'Edit a webhook';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const { environment, webhookID } = argv;
  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  const headers = await Config.getBearerHeader();

  const query = `query getWebhook($id: ID!) {
    webhook(id: $id) {
      name
      targetUrl
      secretKey
    }
  }`;

  const {
    data: { webhook },
  } = await got
    .post(endpoint, {
      headers,
      json: {
        query,
        variables: {
          id: webhookID,
        },
      },
    })
    .json();

  console.log(`  Editing the webhook for the ${environment} environment`);

  const form = await Enquirer.prompt<{
    name: string;
    targetUrl: string;
    secretKey: string;
  }>([
    {
      type: 'input',
      name: 'name',
      message: 'Name',
      initial: webhook.name,
      required: true,
      validate: (value) => validatePresence(value),
    },
    {
      type: 'input',
      name: 'targetUrl',
      message: 'Target URL',
      initial: webhook.targetUrl,
      required: true,
      validate: (value) => validatePresence(value),
    },
    {
      type: 'input',
      name: 'secretKey',
      message: 'Secret',
      initial: webhook.secretKey,
    },
  ]);

  const { data, errors }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: doWebhookUpdate,
        variables: {
          id: webhookID,
          input: {
            ...form,
          },
        },
      },
    })
    .json();

  console.log(chalk(chalk.green('✔'), chalk.bold('Webhook updated')));

  process.exit(0);
};

export const middlewares = [interactiveSaleorApp, interactiveWebhook];
