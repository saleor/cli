import { cli } from 'cli-ux';

import { API, GET } from "../../lib/index.js";

export const command = "list";
export const desc = "List environments";

export const handler = async () => {
  const result = await GET(API.Environment, { environment_id: '' }) as any[]; 

  cli.table(result, {
    key: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2 }
  });

  process.exit(0);
};
