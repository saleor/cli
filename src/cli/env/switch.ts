import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { obfuscateArgv, promptEnvironment } from '../../lib/util.js';
import { verifyEnvironment } from '../../middleware/index.js';
import { BaseOptions } from '../../types.js';

interface Options extends BaseOptions {
  key?: string;
}

const debug = Debug('saleor-cli:env:switch');

export const command = 'switch [key|environment]';
export const desc = 'Make the provided environment the default one';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const environment = await getEnvironment(argv);

  await Config.set('environment_id', environment.value);
};

const getEnvironment = async (argv: Arguments<Options>) => {
  const { environment, token, organization } = argv;

  if (environment && token && organization) {
    const { key } = await verifyEnvironment(token, organization, environment);
    return { name: key, value: key };
  }

  const data = await promptEnvironment(argv);

  return data;
};
