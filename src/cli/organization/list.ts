import { CliUx } from '@oclif/core';
import { API, GET } from "../../lib/index.js";
import { format } from 'date-fns';
import { Options } from '../../types.js';
import { Arguments } from 'yargs';
import chalk from 'chalk';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List organizations";

export const handler = async (argv: Arguments<Options>) => {
  const result = await GET(API.Organization, { ...argv, organization: '' }) as any[];

  if (!result.length) {
    console.warn(chalk.red(" No organizations found"))
    process.exit(0);
  }

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2, get: _ => format(new Date(_.created), "yyyy-MM-dd HH:mm") },
    company_name: { minWidth: 2 },
    owner_email: { minWidth: 2, get: _ => _.owner.email },
  });
};
