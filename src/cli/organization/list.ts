import { ux as cli } from '@oclif/core';
import { format } from 'date-fns';
import Debug from 'debug';
import { Arguments } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { obfuscateArgv, verifyResultLength } from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:org:list');

export const command = 'list';
export const desc = 'List organizations';

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const result = (await GET(API.Organization, {
    ...argv,
    organization: '',
  })) as any[];

  verifyResultLength(result, 'organization');

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  cli.table(result, {
    slug: { minWidth: 2 },
    name: { minWidth: 2 },
    created: {
      minWidth: 2,
      get: (_) => format(new Date(_.created), 'yyyy-MM-dd HH:mm'),
    },
    company_name: { minWidth: 2 },
    owner_email: { minWidth: 2, get: (_) => _.owner.email },
  });
};
