import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import {
  formatDateTime,
  obfuscateArgv,
  verifyResultLength,
} from '../../lib/util.js';
import { Backup, Options } from '../../types.js';
import {
  useBlockingTasksChecker,
  useOrganization,
  useToken,
} from '../../middleware/index.js';

const debug = Debug('saleor-cli:backup:list');

export const command = 'list';
export const desc = 'List backups of the organization';

export const builder: CommandBuilder = (_) =>
  _.option('name', {
    type: 'string',
    demandOption: false,
    desc: 'filter the output for name for backup',
  })
    .option('latest', {
      type: 'boolean',
      default: false,
      demandOption: false,
      desc: 'show only the latest backup',
    })
    .example('saleor backup list', '')
    .example('saleor backup list --organization="organization-slug"', '');

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  debug(`Listing for ${argv.key}`);
  const result = (await (GET(API.Backup, argv) as Promise<Backup[]>))
    .filter((backup) => {
      if (argv.name) {
        return backup.name === argv.name;
      }

      return true;
    })
    .filter((_backup, index) => {
      if (argv.latest) {
        return index === 0;
      }

      return true;
    });

  verifyResultLength(result, 'backup', argv.json);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { ux: cli } = CliUx;

  cli.table(result, {
    name: {
      header: 'Backup',
      minWidth: 2,
      get: ({ name }) => chalk.cyan(name),
    },
    environment_name: {
      header: 'Environment',
      minWidth: 2,
      get: ({ environment_name: environment }) => chalk.green(environment),
    },
    version: {
      header: 'Ver.',
      minWidth: 2,
      get: ({ saleor_version: version }) => chalk.yellow(version),
    },
    created: {
      minWidth: 2,
      get: ({ created }) => chalk.gray(formatDateTime(created)),
    },
    key: { minWidth: 2 },
  });
};

export const middlewares = [useToken, useOrganization, useBlockingTasksChecker];
