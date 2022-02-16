import { cli } from 'cli-ux';
import { Arguments } from 'yargs';

import { API, GET } from "../../lib/index.js";

export const command = "list";
export const desc = "List backups";

export const handler = async (argv: Arguments) => {
  const { env } = argv;

  const options = env ? { environment_id : env } : {}
  const result = await GET(API.Backup, options) as any[]; 

  cli.table(result, {
    key: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2 }
  });

  process.exit(0);
};
