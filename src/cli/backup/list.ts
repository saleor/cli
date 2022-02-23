import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { promptEnvironment, formatDateTime } from '../../lib/util.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List backups";

// const setup: void = (handler) => {

//   handler()
// } 


export const handler = async (argv: Arguments<Options>) => {
  const { environment } = argv;

  console.log(`\n ${chalk.bgGray(' CONTEXT ')} ${chalk.gray('Environment')} ${chalk.underline(environment)} • ${chalk.gray('Organization')} ${'something'} \n`)
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