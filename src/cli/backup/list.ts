import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { formatDateTime, verifyResultLength } from '../../lib/util.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = 'list [key|environment]';
export const desc = 'List backups of the environment';

export const handler = async (argv: Arguments<Options>) => {
  const result = (await GET(API.Backup, argv)) as any[];

  verifyResultLength(result, 'backup');

  cli.table(result, {
    name: {
      header: 'Backup',
      minWidth: 2,
      get: ({ name }) => chalk.cyan(name),
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
