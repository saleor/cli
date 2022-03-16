import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import got from 'got';
import { Arguments } from 'yargs';

import { API, GET } from "../../lib/index.js";
import { makeRequestRefreshToken, printContext } from '../../lib/util.js';
import { interactiveSaleorApp } from '../../middleware/index.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List webhooks for an environment";

const SaleorAppByID = `
query AppSingle($appID: ID!) {
  app(id: $appID) {
    id
    name
    isActive
    type
    webhooks {
      id
      name
      targetUrl
    }
  }
}
`


export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment, app: appID } = argv;

  printContext(organization, environment)

  const { domain } = await GET(API.Environment, argv) as any; 

  const token = await makeRequestRefreshToken(domain);

  // const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
  //   headers: {
  //     'authorization-bearer': token,
  //     'content-type': 'application/json',
  //   },
  //   json: { query }
  // }).json()

  // const { apps: { edges: apps } } = data;

  // if (!apps) {
  //   console.warn(chalk.red(" No webhooks found for this environment"))
  //   process.exit(0);
  // };

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    headers: {
      'authorization-bearer': token,
      'content-type': 'application/json',
    },
    json: { 
      query: SaleorAppByID, 
      variables: { appID }
    }
  }).json()

  const { app: { name, webhooks } } = data;

  console.log(` App: ${name}\n`)

  cli.table(webhooks, {
    name: { 
      header: 'Name', 
      minWidth: 2,
      get: ({ name }) => chalk.cyan(name)
    },
    targetUrl: { 
      header: 'URL', 
      get: ({ targetUrl }) => chalk.yellow(targetUrl)
    },
    id: { 
      header: 'ID',
      minWidth: 2 
    },
  });

  process.exit(0);
};

export const middlewares = [
  interactiveSaleorApp,
]