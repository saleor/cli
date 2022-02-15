import { cli } from 'cli-ux';

import { API, GET } from "../../lib/index.js";

export const command = "list";
export const desc = "List jobs";

export const handler = async () => {
  const result = await GET(API.Job) as any[]; 

  cli.table(result, {
    job_name: { minWidth: 2 },
    created_at: { minWidth: 2 },
    status: { minWidth: 2 },
  });

  process.exit(0);
};
