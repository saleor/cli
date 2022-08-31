import type { Arguments, CommandBuilder } from 'yargs';

import { getEnvironment } from '../../lib/environment.js';
import { showResult } from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'show [key|environment]';
export const desc = 'Show a specific environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  const result = await getEnvironment(argv);

  showResult(result, argv);
};

export const middlewares = [useEnvironment];
