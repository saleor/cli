import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import { Arguments } from 'yargs';

import { API, GET } from "../../lib/index.js";
import { formatDateTime, printContext } from '../../lib/util.js';
import { Options } from '../../types.js';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List projects";


export const handler = async (argv: Arguments<Options>) => {
  const { organization } = argv;

  printContext(organization)

  const result = await GET(API.Project, argv) as any[]; 

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2,  get: ({ name }) => chalk.cyan(name) },
    billing_period: { 
      minWidth: 2, 
      get: ({ billing_period }) => chalk.gray(formatDateTime(billing_period.start))
    },

    region: { minWidth: 2 },
    sandboxes: { 
      minWidth: 5, 
      header: '#', 
      get: _ => chalk.yellow(_.sandboxes.count) },
  });

  process.exit(0);
};
