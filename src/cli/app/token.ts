import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print as gqlPrint } from 'graphql';
import { Arguments, CommandBuilder } from 'yargs';

import { AppTokenCreate, GetApps } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import {
  contentBox,
  getAppsFromResult,
  obfuscateArgv,
  print,
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
  })
    .example('saleor app token', '')
    .example('saleor app token --app-id="app-id"', '')
    .example(
      'saleor app token --app-id="app-id=" --organization="organization-slug" --environment="env-id-or-name"',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  printContext(argv);

  const { instance, json, short } = argv;

  let appId: string;

  if (!argv.appId) {
    const { app } = await getSaleorApp({ instance, json });
    appId = app!;
  } else {
    appId = argv.appId as string;
  }

  debug(`Creating auth token for ${appId}`);
  try {
    const authToken = await createAppToken(instance, appId);

    if (short) {
      print(authToken);
      process.exit(0);
    }

    if (json) {
      print(`{ "token": "${authToken}" }`);
      process.exit(0);
    }

    console.log();
    contentBox(`  ${authToken}`, { title: 'Your Token' });
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
        query: gqlPrint(AppTokenCreate),
        variables: { app },
      },
    })
    .json();

  const {
    appTokenCreate: { authToken },
  } = data;
  return authToken;
};

export const getSaleorApp = async ({
  instance,
  appId = undefined,
  json,
}: {
  instance: string;
  appId?: string | undefined;
  json: boolean | undefined;
}) => {
  const headers = await Config.getBearerHeader();

  debug('Fetching Saleor Apps');
  const { data }: any = await got
    .post(instance, {
      headers,
      json: {
        query: gqlPrint(GetApps),
        variables: {},
      },
    })
    .json();

  const apps = getAppsFromResult(data, json);

  debug(`Available apps ${apps}`);

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
