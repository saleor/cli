import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import got from 'got';
import { Arguments } from 'yargs';
import { WebhookList } from '../../graphql/WebhookList.js';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List webhooks for an environment";

export const handler = async (argv: Arguments<Options>) => {
  const { domain } = await GET(API.Environment, argv) as any;
  const { token } = await Config.get();

  const url = `https://${domain}/graphql`;

  const { data, errors }: any = await got.post(url, {
    headers: {
      'Authorization-Bearer': token.split(' ').slice(-1),
      'Content-Type': 'application/json',
    },
    json: {
      query: WebhookList
    }
  }).json()

  if (!data.apps) {
    console.warn(chalk.red(" No webhooks found for this environment"))
    process.exit(0);
  }

  if (errors) {
    throw Error("cannot auth")
  }

  const { apps: { edges: apps } } = data;

  for (const { node: { name, webhooks }} of apps) {
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