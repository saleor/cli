import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';

import { API, GET } from "../../lib/index.js";
import { formatDateTime } from '../../lib/util.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List environments";

export const handler = async (argv: Arguments) => {
  const result = await GET(API.Environment, { ...argv, environment: '' }) as any[]; 

  cli.table(result, {
    name: { minWidth: 2, get: ({ name }) => chalk.cyan(name) },
    created: { minWidth: 2, get: ({ created }) => chalk.gray(formatDateTime(created)) },
    project: { minWidth: 2, get: _ => _.project.name },
    service: { minWidth: 2, header: 'Ver.', get: _ => chalk.yellow(_.service.version) },
    key: { minWidth: 2 },
  });

  process.exit(0);
};
