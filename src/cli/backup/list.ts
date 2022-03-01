import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';

import { API, GET } from "../../lib/index.js";
import { formatDateTime, printContext } from '../../lib/util.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List backups";

export const handler = async (argv: Arguments<Options>) => {
  const { organization, environment } = argv;

  printContext(organization, environment)
  const result = await GET(API.Backup, argv) as any[];

  if (!result.length) {
    console.warn(chalk.red(" No backups found for this environment"))
    process.exit(0);
  };

  cli.table(result, {
    name: { 
      header: 'Backup', 
      minWidth: 2,
      get: ({ name }) => chalk.cyan(name)
    },
    version: { 
      header: 'Ver.', 
      minWidth: 2,
      get: ({ saleor_version: version }) => chalk.yellow(version)
    },
    created: { 
      minWidth: 2,  
      get: ({ created }) => chalk.gray(formatDateTime(created))
    },
    key: { minWidth: 2 },
  });

  process.exit(0);
};