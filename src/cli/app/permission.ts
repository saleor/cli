import Enquirer from "enquirer";
import { Arguments } from "yargs";
import got from "got";
import { print } from "graphql";

import { AppUpdate, GetPermissionEnum } from "../../generated/graphql.js";
import { SaleorAppList } from "../../graphql/SaleorAppList.js";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import { getAppsFromResult, printContext } from "../../lib/util.js";
import {
  useEnvironment,
  useOrganization,
  useToken,
} from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "permission";
export const desc = "Add or remove permission for a Saleor App";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment);

  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const endpoint = `https://${domain}/graphql/`;

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
    type: "autocomplete",
    name: "app",
    choices,
    message: "Select a Saleor App (start typing) ",
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
  const { permissions } = await Enquirer.prompt<{ permissions: string[] }>({
    type: "multiselect",
    name: "permissions",
    muliple: true,
    choices: choices2,
    message: "Select one or more permissions (start typing) ",
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

  console.log(`Permissions successfully updated.`);
};

export const middlewares = [useToken, useOrganization, useEnvironment];
