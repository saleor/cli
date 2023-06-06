import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import { Arguments, CommandBuilder } from 'yargs';

import { AppTokenCreate, GetApps } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import {
  contentBox,
  getAppsFromResult,
  obfuscateArgv,
  printContext,
} from '../../lib/util.js';
import {
  useAppConfig,
  useAvailabilityChecker,
  useInstanceConnector,
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
  debug('command arguments: %O', obfuscateArgv(argv));

  const { organization, environment, short } = argv;

  if (!short) printContext(organization, environment);

  const { instance } = argv;
  const endpoint = `${instance}/graphql/`;
  debug(`Saleor endpoint: ${endpoint}`);

  let appId: string;

  if (!argv.appId) {
    const { app } = await getSaleorApp(endpoint);
    appId = app!;
  } else {
    appId = argv.appId as string;
  }

  debug(`Creating auth token for ${appId}`);
  try {
    const authToken = await createAppToken(endpoint, appId);

    if (short) {
      process.stdout.write(authToken);
    } else {
      console.log();
      contentBox(`  ${authToken}`, { title: 'Your Token' });
    }
  } catch (error) {
    console.log(error);
  }
};

export const createAppToken = async (url: string, app: string) => {
  const headers = await Config.getBearerHeader();

  debug(`Getting app token for ${app}`);
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

export const getSaleorApp = async (
  endpoint: string,
  appId: string | undefined = undefined
) => {
  const headers = await Config.getBearerHeader();

  debug('Fetching Saleor Apps');
  const { data }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: print(GetApps),
        variables: {},
      },
    })
    .json();

  const apps = getAppsFromResult(data);

  // return early if appId have been provided and it's found in apps
  if (apps.map(({ node }: any) => node.id).includes(appId)) {
    return { app: appId, apps };
  }

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

export const middlewares = [
  useAppConfig,
  useInstanceConnector,
  useAvailabilityChecker,
];
