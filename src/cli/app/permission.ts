import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import { Arguments, CommandBuilder } from 'yargs';

import { AppUpdate, GetPermissionEnum } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { obfuscateArgv, printContext, println } from '../../lib/util.js';
import {
  useAppConfig,
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { Options } from '../../types.js';
import { getSaleorApp } from './token.js';

const debug = Debug('saleor-cli:app:permission');

export const command = 'permission';
export const desc = 'Add or remove permission for a Saleor App';

export const builder: CommandBuilder = (_) =>
  _.option('app-id', {
    type: 'string',
    demandOption: false,
    desc: 'The Saleor App id',
  })
    .option('permissions', {
      type: 'array',
      demandOption: false,
      desc: 'The array of permissions',
    })
    .example(
      'saleor app permission --app-id=APP-ID --permissions=MANAGE_USERS --permissions=MANAGE_STAFF',
      ''
    )
    .example(
      'saleor app permission --organization=organization-slug --environment=env-id-or-name --app-id=APP-ID --permissions=MANAGE_USERS --permissions=MANAGE_STAFF',
      ''
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { organization, environment } = argv;

  printContext(organization, environment);

  const { instance } = argv;
  const endpoint = `${instance}/graphql/`;
  debug(`Saleor endpoint: ${endpoint}`);

  const { app, apps } = await getSaleorApp(endpoint, argv.appId);
  const permissions =
    argv.permissions ?? (await getPermissions(endpoint, apps, app));

  debug(`Attempting to update the permissions for the app: ${app}`);
  const headers = await Config.getBearerHeader();
  await got
    .post(endpoint, {
      headers,
      json: {
        query: print(AppUpdate),
        variables: { app, permissions },
      },
    })
    .json();

  console.log('Permissions successfully updated.');
};

const getPermissions = async (
  endpoint: string,
  apps: any,
  app: string | undefined
) => {
  if (!app) {
    println(` ${chalk.red('No app selected')}`);
    process.exit(0);
  }

  const headers = await Config.getBearerHeader();
  debug('Fetching permission enum list');
  const {
    data: {
      __type: { enumValues },
    },
  }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: print(GetPermissionEnum),
        variables: {},
      },
    })
    .json();

  const choices2 = enumValues.map((node: any) => ({
    name: node.name,
    value: node.name,
    hint: node.description,
  }));

  const {
    node: { permissions: currentPermissions },
  } = apps.filter(({ node }: any) => node.id === app)[0];
  const choices2Names = choices2.map(({ name }: any) => name);
  const initial = currentPermissions.map((permission: any) =>
    choices2Names.indexOf(permission.code)
  );

  const { permissions } = await Enquirer.prompt<{ permissions: string[] }>({
    type: 'multiselect',
    name: 'permissions',
    muliple: true,
    choices: choices2,
    initial,
    message:
      'Select one or more permissions\n  (use the arrows to navigate and the space bar to select)',
  });

  return permissions;
};

export const middlewares = [
  useAppConfig,
  useInstanceConnector,
  useAvailabilityChecker,
];
