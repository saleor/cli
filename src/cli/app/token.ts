import boxen from 'boxen';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import { Arguments, CommandBuilder } from 'yargs';

import { AppTokenCreate } from '../../generated/graphql.js';
import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { Config } from '../../lib/config.js';
import { getEnvironmentGraphqlEndpoint } from '../../lib/environment.js';
import { getAppsFromResult, printContext } from '../../lib/util.js';
import {
  useEnvironment,
  useOrganization,
  useToken,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:token');

export const command = 'token';
export const desc = 'Create a Saleor App token';

export const builder: CommandBuilder = (_) =>
  _.option('app-id', {
    type: 'string',
    demandOption: false,
    desc: 'The Saleor App id',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', argv);

  const { organization, environment } = argv;

  printContext(organization, environment);

  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  debug(`Saleor endpoint: ${endpoint}`);

  let appId: string;

  if (!argv.appId) {
    const { app } = await getSaleorApp(endpoint);
    appId = app;
  } else {
    appId = argv.appId as string;
  }

  debug(`Creating auth token for ${appId}`);
  try {
    const authToken = await createAppToken(endpoint, appId);
    console.log();
    console.log(boxen(`Your Token: ${authToken}`, { padding: 1 }));
  } catch (error) {
    console.log(error);
  }

  process.exit(0);
};

export const createAppToken = async (url: string, app: string) => {
  const headers = await Config.getBearerHeader();

  const { data }: any = await got
    .post(url, {
      headers,
      json: {
        query: print(AppTokenCreate),
        variables: { app },
      },
    })
    .json();

  const {
    appTokenCreate: { authToken },
  } = data;
  return authToken;
};

export const getSaleorApp = async (endpoint: string) => {
  const headers = await Config.getBearerHeader();

  debug('Fetching Saleor Apps');
  const { data }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: SaleorAppList,
        variables: {},
      },
    })
    .json();

  const apps = getAppsFromResult(data);

  const choices = apps.map(({ node }: any) => ({
    name: node.name,
    value: node.id,
    hint: node.id,
  }));

  const { app } = await Enquirer.prompt<{ app: string }>({
    type: 'autocomplete',
    name: 'app',
    choices,
    message: 'Select a Saleor App (start typing) ',
  });

  return { app, apps };
};

export const middlewares = [useToken, useOrganization, useEnvironment];
