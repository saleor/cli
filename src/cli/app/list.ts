import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import got from 'got';
import { Arguments } from 'yargs';
import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { formatDateTime, printContext } from '../../lib/util.js';
import { useEnvironment, useOrganization, useToken } from '../../middleware/index.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List webhooks for an environment";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment, app: appID } = argv;

  printContext(organization, environment)

  const { domain } = await GET(API.Environment, argv) as any; 
  const { token } = await Config.get();

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    headers: {
      'Authorization-Bearer': token.split(' ').slice(-1),
    },
    json: { 
      query: SaleorAppList, 
      variables: {}
    }
  }).json()

  if (errors) {
    throw Error("cannot auth")
  }

  const { apps: { edges } } = data;

  const collection: any[] = edges.map(({ node }: any) => ({ ...node }))

  cli.table(collection, {
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
    type: { 
      header: 'URL', 
      get: ({ type }) => chalk.yellow(type)
    },
    isActive: { 
      header: 'Active?',
      minWidth: 2,
      get: ({ isActive }) => isActive ? chalk.green('Yes') : chalk.red('No'),
    },
    webhooks: { 
      header: 'Webhooks #',
      minWidth: 2,
      get: ({ webhooks }) => (webhooks as string[]).length,
    },
    created: { 
      header: 'Created',
      minWidth: 2,
      get: ({ created }) => chalk.gray(formatDateTime(created)),
    },
  });

  process.exit(0);
};

export const middlewares = [
  useToken, useOrganization, useEnvironment
]
