import { CliUx } from '@oclif/core';
import { API, GET } from "../../lib/index.js";
import { format } from 'date-fns';

const { ux: cli } = CliUx;

export const command = "list";
export const desc = "List environments";

export const handler = async () => {
  const result = await GET(API.Organization, { organization_slug: '' }) as any[]; 

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2 },
    created: { minWidth: 2, get: _ => format(new Date(_.created), "yyyy-MM-dd HH:mm") },
    company_name: { minWidth: 2 },
    owner_email: { minWidth: 2, get: _ => _.owner.email },
  });

  process.exit(0);
};
