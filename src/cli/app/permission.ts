import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import { Arguments } from 'yargs';

import { AppUpdate, GetPermissionEnum } from '../../generated/graphql.js';
import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { Config } from '../../lib/config.js';
import POST from '../../lib/got.js';
import { API, GET } from '../../lib/index.js';
import { getAppsFromResult, printContext } from '../../lib/util.js';
import {
  useEnvironment,
  useOrganization,
  useToken,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'permission';
export const desc = 'Add or remove permission for a Saleor App';

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment);

  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const endpoint = `https://${domain}/graphql/`;

  const data = await POST(endpoint, headers, {
    query: SaleorAppList,
    variables: {},
  });

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

export const middlewares = [useToken, useOrganization, useEnvironment];
