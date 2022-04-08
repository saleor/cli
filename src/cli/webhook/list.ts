import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import got from 'got';
import { Arguments } from 'yargs';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List webhooks for an environment";

const AppList = `
query AppList {
  apps (
    first: 0
    last:100
  ) {
    totalCount
    edges {
      node {
        id
        name
        isActive
        webhooks {
          id
          name
          isActive
          targetUrl
          syncEvents {
            eventType
          }
          asyncEvents {
            eventType
          }
        }
        __typename
      }
      __typename
    }
    __typename
  }
}
`

export const handler = async (argv: Arguments<Options>) => {
  const { domain } = await GET(API.Environment, argv) as any;
  const { token } = await Config.get();

  const url = `https://${domain}/graphql`;

  const { data, errors }: any = await got.post(url, {
    headers: {
      'authorization-bearer': token.split(' ').slice(-1),
      'content-type': 'application/json',
    },
    json: {
      query: AppList
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