import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { showResult } from '../../lib/util.js';
import { useOrganization } from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'permissions [slug|organization]';
export const desc = 'List organization permissions';

export const builder: CommandBuilder = (_) =>
  _.positional('slug', {
    type: 'string',
    demandOption: false,
    desc: 'slug of the organization',
  });

export const handler = async (argv: Arguments<Options>) => {
  const result = (await GET(API.OrganizationPermissions, {
    ...argv,
    ...{ organization: argv.slug || argv.organization },
  })) as any;

  showResult(result);
};

export const middlewares = [useOrganization];
