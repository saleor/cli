import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import { request } from 'graphql-request';
import type { Arguments, CommandBuilder } from 'yargs';

import * as SaleorGraphQL from '../generated/graphql.js';
import { Config } from '../lib/config.js';
import { DefaultSaleorEndpoint } from '../lib/index.js';
import { capitalize, obfuscateArgv, SaleorEventError } from '../lib/util.js';
import { useAppConfig, useInstanceConnector } from '../middleware/index.js';
import { Options } from '../types.js';

const debug = Debug('saleor-cli:trigger');

export const command = 'trigger [event]';
export const desc = 'This triggers a Saleor event';

export const builder: CommandBuilder = (_) =>
  _.option('event', { type: 'string' }).option('id', { type: 'string' });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { id, instance } = argv;
  let { event } = argv;

  const {
    __type: { enumValues },
  } = await request<{ __type: { enumValues: unknown } }>(
    DefaultSaleorEndpoint,
    SaleorGraphQL.GetWebhookEventEnum,
  );
  const choices = enumValues as Record<string, string>[];

  if (!event) {
    const prompt = new (Enquirer as any).AutoComplete({
      name: 'event',
      message: 'Select a web hook event (start typing)',
      limit: 10,
      choices,
    });

    event = (await prompt.run()) as string;
  }

  if (!choices.map((_) => _.name).includes(event.toUpperCase())) {
    throw new SaleorEventError('Wrong event name');
  }

  const webhookName = event.toLowerCase().replaceAll('_', '-');
  const operationName = webhookName
    .split('-')
    .map(capitalize)
    .join('')
    .slice(0, -1);

  if (!(operationName in SaleorGraphQL)) {
    throw new SaleorEventError('Operation not implemented');
  }

  console.log(
    `\n  GraphQL Operation for ${chalk.underline(event)} available\n`,
  );

  const headers = await Config.getBearerHeader();

  // FIXME
  // check if CLI input matches the GraphQL signature
  // e.g. if `id` is required or not

  try {
    const result = await request(
      instance,
      (SaleorGraphQL as any)[operationName],
      {
        id,
        input: {},
      },
      headers,
    );

    console.log(result);
  } catch (error: any) {
    const {
      response: { errors },
    } = error;

    for (const { message } of errors) {
      console.error(message);
    }
  }

  process.exit(0);
};

export const middlewares = [useAppConfig, useInstanceConnector];
