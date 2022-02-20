import { Arguments, CommandBuilder } from 'yargs';
import { CliUx } from '@oclif/core';

import { API, GET } from "../../lib/index.js";

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List jobs";

export const builder: CommandBuilder = (_) =>
  _.option("env", { type: 'string' })

export const handler = async (argv: Arguments) => {
  const { env } = argv;

  const options = env ? { environment_id : env } : {}
  const result = await GET(API.Job, options) as any[]; 

  cli.table(result, {
    job_name: { minWidth: 2 },
    created_at: { minWidth: 2 },
    status: { minWidth: 2 },
  });

  process.exit(0);
};
