import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import got from 'got';
import { Arguments } from 'yargs';
import { WebhookList } from '../../graphql/WebhookList.js';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { getAppsFromResult } from '../../lib/util.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List webhooks for an environment";

export const handler = async (argv: Arguments<Options>) => {
  const { domain } = await GET(API.Environment, argv) as any;
  const headers = await Config.getBearerHeader();

  const url = `https://${domain}/graphql`;

  const { data }: any = await got.post(url, {
    headers,
    json: {
      query: WebhookList
    }
  }).json()

  const apps = getAppsFromResult(data);

  for (const { node: { name, webhooks } } of apps) {
    console.log(`\n App: ${name}\n`)

    cli.table(webhooks, {
      id: {
        header: 'ID',
        minWidth: 2,
        get: ({ id }) => chalk.gray(id)
      },
      name: {
        header: 'Name',
        minWidth: 2,
        get: ({ name }) => chalk.cyan(name)
      },
      targetUrl: {
        header: 'URL',
        get: ({ targetUrl }) => chalk.yellow(targetUrl)
      },
      isActive: {
        header: 'Active?',
        minWidth: 2,
        get: ({ isActive }) => isActive ? chalk.green('Yes') : chalk.red('No'),
      },
      syncEvents: {
        header: 'Sync',
        minWidth: 2,
        get: ({ syncEvents }) => (syncEvents as string[]).length,
      },
      asyncEvents: {
        header: 'Async',
        minWidth: 2,
        get: ({ asyncEvents }) => (asyncEvents as string[]).length,
      },
    });
  }
};