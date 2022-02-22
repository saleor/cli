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
  const options = { environment_id: env };

  const result = await getBackups(options)

  if (!result.length) {
    console.warn(chalk.red("No backups found"))
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


export const getBackups = async (options: { environment_id?: string | undefined}) => {
  const config = await Config.get()

  if (!options.environment_id && !config.environment_id) {
    const environment_id = await chooseDefaultEnvironment(config.token, config.organization_slug);
    options.environment_id = environment_id
  }

  const result = await GET(API.Backup, options) as any[];
  return result

}