import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { showResult } from '../../lib/util.js';
import { useOrganization } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:org:show');

export const command = 'show [slug|organization]';
export const desc = 'Show a specific organization';

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  debug(`command arguments: ${JSON.stringify(argv, null, 2)}`);
  const result = (await GET(API.Organization, argv)) as any;

  showResult(result, argv);
};

export const middlewares = [useOrganization];
