import { cli } from 'cli-ux';
import { format } from 'date-fns';

import { API, GET } from "../../lib/index.js";

export const command = "list";
export const desc = "List environments";

export const handler = async () => {
  const result = await GET(API.Environment, { environment_id: '' }) as any[]; 

  cli.table(result, {
    key: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2, get: _ => format(new Date(_.created), "yyyy-MM-dd HH:mm") },
    project: { minWidth: 2, get: _ => _.project.name },
    service: { minWidth: 2, header: 'Ver.', get: _ => _.service.version },
  });

  process.exit(0);
};
