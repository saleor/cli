import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import { print } from 'graphql';
import { Arguments } from 'yargs';

import { WebhookList } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { getAppsFromResult, obfuscateArgv } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:webhook:list');

export const command = 'list';
export const desc = 'List webhooks for an environment';

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const { instance } = argv;
  const endpoint = `${instance}/graphql/`;
  const headers = await Config.getBearerHeader();

  const { data }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: print(WebhookList),
      },
    })
    .json();

  const apps = getAppsFromResult(data);

  const webhookList = apps.map((app: any) => app.node.webhooks).flat();

  if (webhookList.length === 0) {
    console.log(
      chalk.red('\n', ' No webhooks found for this environment', '\n')
    );

    console.log(
      chalk(
        '  Create webhook with',
        chalk.green('saleor webhook create'),
        'command'
      )
    );

    process.exit(0);
  }

  if (argv.json) {
    console.log(JSON.stringify(webhookList, null, 2));
    return;
  }

  for (const {
    node: { name: appName, webhooks },
  } of apps) {
    if (webhooks.length === 0) {
      continue;
    }

    console.log(chalk('\n App:', chalk.bold(appName), '\n'));

    const { ux: cli } = CliUx;

    cli.table(webhooks, {
      id: {
        header: 'ID',
        minWidth: 2,
        get: ({ id }) => chalk.gray(id),
      },
      name: {
        header: 'Name',
        minWidth: 2,
        get: ({ name }) => chalk.cyan(name),
      },
      targetUrl: {
        header: 'URL',
        get: ({ targetUrl }) => chalk.yellow(targetUrl),
      },
      isActive: {
        header: 'Active?',
        minWidth: 2,
        get: ({ isActive }) =>
          isActive ? chalk.green('Yes') : chalk.red('No'),
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
