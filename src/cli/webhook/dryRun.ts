import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got, { HTTPError } from 'got';
import { Arguments, CommandBuilder } from 'yargs';

import { doWebhookDryRun } from '../../graphql/doWebhookDryRun.js';
import { Config } from '../../lib/config.js';
import { obfuscateArgv, println, showResult } from '../../lib/util.js';
import { WebhookDryRun, WebhookError } from '../../types.js';

const debug = Debug('saleor-cli:webhook:create');

export const command = 'dry-run';
export const desc = 'Webhook dry run';

export const builder: CommandBuilder = (_) =>
  _.option('object-id', {
    type: 'string',
    demandOption: false,
    desc: 'Object ID to perform dry run on',
  })
    .option('query', {
      type: 'boolean',
      desc: 'Subscription query',
    })
    .example('saleor webhook dry-run', '')
    .example(
      'saleor webhook dry-run --query=\'subscription { event { ... on ProductCreated { product { id name } } } }\'',
      ''
    )
    .example('saleor webhook dry-run --object-id=\'UHJvZHVjdDo3Mg==\'', '');

export const handler = async (argv: Arguments<WebhookDryRun>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { objectId, query } = await Enquirer.prompt<{
    objectId: string;
    query: string;
  }>([
    {
      type: 'input',
      name: 'objectId',
      message: 'Object ID to perform Dry Run on',
      initial: argv.objectId,
      required: true,
      skip: !!argv.objectId,
    },
    {
      type: 'input',
      name: 'query',
      message: 'Subscription query',
      initial:
        argv.query ||
        'subscription { event { ... on ProductCreated { product { id name } } } }',
      required: true,
      skip: !!argv.query,
    },
  ]);

  const { instance } = argv;
  const endpoint = `${instance}/graphql/`;
  const headers = await Config.getBearerHeader();

  try {
    const { data }: any = await got
      .post(endpoint, {
        headers,
        json: {
          query: doWebhookDryRun,
          variables: {
            objectId,
            query,
          },
        },
      })
      .json();

    const { webhookDryRun } = data;

    println('');

    if (!webhookDryRun) {
      println(chalk.red('Couldn\'t find the provided object'));
      return;
    }

    const { payload, errors = [] } = webhookDryRun ?? {};

    if (errors.length) {
      throw new Error(
        errors.map((e: WebhookError) => `\n ${e.field} - ${e.message}`).join()
      );
    }

    println(payload);
  } catch (error) {
    if (error instanceof HTTPError) {
      const { statusCode } = error.response;
      if (statusCode === 400) {
        throw new Error(
          'Seems the selected environment doesn\'t support dry run feature. Required Saleor Version ^3.11'
        );
      }
    }

    throw error;
  }
};
