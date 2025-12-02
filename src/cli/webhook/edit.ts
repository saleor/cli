import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import type { Arguments } from 'yargs';

import { WebhookUpdate } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';
import {
  obfuscateArgv,
  printlnSuccess,
  validatePresence,
} from '../../lib/util.js';
import {
  interactiveSaleorApp,
  interactiveWebhook,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:webhook:edit');

export const command = 'edit';
export const desc = 'Edit a webhook';

export const builder = NoCommandBuilderSetup;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const { environment, webhookID, instance } = argv;
  const headers = await Config.getBearerHeader();

  const query = `query getWebhook($id: ID!) {
    webhook(id: $id) {
      name
      targetUrl
      secretKey
    }
  }`;

  interface WebHook {
    webhook: {
      name: string;
      targetUrl: string;
      secretKey: string;
    };
  }

  const {
    data: { webhook },
  } = await got
    .post(instance!, {
      headers,
      json: {
        query,
        variables: {
          id: webhookID,
        },
      },
    })
    .json<{ data: WebHook }>();

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

  await got
    .post(instance!, {
      headers,
      json: {
        query: print(WebhookUpdate),
        variables: {
          id: webhookID,
          input: {
            ...form,
          },
        },
      },
    })
    .json();

  printlnSuccess(chalk.bold('Webhook updated'));

  process.exit(0);
};

export const middlewares = [interactiveSaleorApp, interactiveWebhook];
