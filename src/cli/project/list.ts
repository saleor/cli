import { CliUx } from '@oclif/core';

import { API, GET } from "../../lib/index.js";

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List projects";

export const handler = async () => {
  const result = await GET(API.Project) as any[]; 

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2 },
    billing_period: { minWidth: 2, get: _ => _.billing_period.start },
    region: { minWidth: 2 },
    sandboxes: { minWidth: 5, header: '#', get: _ => _.sandboxes.count },
  });

  process.exit(0);
};
