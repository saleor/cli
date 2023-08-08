import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import got from 'got';
import { print } from 'graphql';
import type { Arguments, CommandBuilder } from 'yargs';

import { AppCreate } from '../../generated/graphql.js';
import { Config } from '../../lib/config.js';
import { obfuscateArgv, println, validateLength } from '../../lib/util.js';
import {
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { WebhookError } from '../../types.js';
import { choosePermissions, getPermissionsEnum } from './permission.js';

const debug = Debug('saleor-cli:app:create');

export const command = 'create [name]';
export const desc = 'Create a new Saleor Local App';

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: false,
    desc: 'name for the new Local App',
  })
    .option('permissions', {
      type: 'array',
      demandOption: false,
      desc: 'The array of permissions',
    })
    .example(
      'saleor app create --name=my-saleor-app --permissions=MANAGE_USERS --permissions=MANAGE_STAFF',
      '',
    )
    .example(
      'saleor app create --name=my-saleor-app --organization=organization-slug --environment=env-id-or-name --permissions=MANAGE_USERS --permissions=MANAGE_STAFF',
      '',
    );

export const handler = async (argv: Arguments<any>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { name } = (await Enquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Local App name',
      initial: argv.name,
      required: true,
      skip: !!argv.name,
      validate: (value) => validateLength(value, 255),
    },
  ])) as { name: string };

  debug(`Using the name: ${name}`);

  const { instance } = argv;
  const endpoint = `${instance}/graphql/`;
  const headers = await Config.getBearerHeader();
  const availablePermissions = await getPermissionsEnum(endpoint);

  const permissions =
    argv.permissions ?? (await choosePermissions(availablePermissions, 0));

  const { data }: any = await got
    .post(endpoint, {
      headers,
      json: {
        query: print(AppCreate),
        variables: {
          name,
          permissions,
        },
      },
    })
    .json();

  const {
    appCreate: { app, errors },
  } = data;

  if (errors.length) {
    throw new Error(
      errors.map((e: WebhookError) => `\n ${e.field} - ${e.message}`).join(),
    );
  }

  if (argv.json) {
    console.log(JSON.stringify(app, null, 2));
    return;
  }

  println(chalk('App created with id', chalk.green(app?.id)));
};

export const middlewares = [useInstanceConnector, useAvailabilityChecker];
