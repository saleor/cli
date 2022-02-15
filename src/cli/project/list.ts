import { cli } from 'cli-ux';

import { API, GET } from "../../lib/index.js";

export const command = "list";
export const desc = "List projects";

export const handler = async () => {
  const result = await GET(API.Project) as any[]; 

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2 },
    billing_period: { minWidth: 2, get: _ => _.billing_period.start },
    region: { minWidth: 2 },
  });

  process.exit(0);
};
