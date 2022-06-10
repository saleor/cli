import Enquirer from 'enquirer';
import { Arguments } from 'yargs';
import got from 'got';
import { print } from 'graphql'

import { AppTokenCreate } from '../../generated/graphql.js';
import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { Config } from '../../lib/config.js';
import { API, GET } from '../../lib/index.js';
import { getAppsFromResult, printContext } from '../../lib/util.js';
import { useEnvironment, useOrganization, useToken } from '../../middleware/index.js';
import { Options } from '../../types.js';
import boxen from 'boxen';

export const command = "token";
export const desc = "Create a Saleor App token";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment)

  const { domain } = await GET(API.Environment, argv) as any;
  const headers = await Config.getBearerHeader();

  const endpoint = `https://${domain}/graphql/`;

  const { data }: any = await got.post(endpoint, {
    headers,
    json: {
      query: SaleorAppList,
      variables: {}
    }
  }).json()

  const apps = getAppsFromResult(data);

  const choices = apps.map(({ node }: any) => ({ name: node.name, value: node.id, hint: node.id }))

  const { app } = await Enquirer.prompt<{ app: string }>({
    type: 'autocomplete',
    name: 'app',
    choices,
    message: 'Select a Saleor App (start typing) ',
  });

  try {
    const authToken = createAppToken(endpoint, app)
    console.log();
    console.log(boxen(`Your Token: ${authToken}`, { padding: 1 }));
  } catch (error) {
    console.log(error)
  }

  process.exit(0);
};

export const createAppToken = async (url: string, app: string) => {
  const headers = await Config.getBearerHeader();

  const { data }: any = await got.post(url, {
    headers,
    json: {
      query: print(AppTokenCreate),
      variables: { app }
    }
  }).json()

  const { appTokenCreate: { authToken } } = data;
  return authToken;
}

export const middlewares = [
  useToken, useOrganization, useEnvironment
]