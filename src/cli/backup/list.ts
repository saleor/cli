import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';
import { Config } from '../../lib/config.js';

import { API, GET } from "../../lib/index.js";
import { chooseDefaultEnvironment, formatDateTime } from '../../lib/util.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List backups";

export const handler = async (argv: Arguments) => {
  const { env } = argv;

  const options = env ? { environment_id : env } : {}
  const result = await GET(API.Backup, options) as any[]; 

  const { token, organization_slug } = await Config.get()
  const environment_id = await chooseDefaultEnvironment(token, organization_slug);
  console.log(`Showing backups for the environment: ${environment_id}`)

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
