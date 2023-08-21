import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { getEnvironment } from '../../lib/environment.js';
import { API, PUT } from '../../lib/index.js';
import {
  obfuscateArgv,
  promptCompatibleVersion,
  showResult,
} from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:promote');

export const command = 'promote [key|environment]';
export const desc = 'Promote environment to production';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  }).option('saleor', {
    type: 'string',
    desc: 'specify the Saleor version',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const service = await getService(argv);
  const result = (await PUT(API.UpgradeEnvironment, argv, {
    json: { service: service.value },
  })) as any;
  showResult(result, argv);
};

const getService = async (argv: Arguments<Options>) => {
  if (argv.saleor) {
    return { key: argv.saleor, value: argv.saleor };
  }

  const env = await getEnvironment(argv);
  const data = await promptCompatibleVersion({
    ...argv,
    region: env.service.region,
    serviceName: `?compatible_with=${env.service.version}`,
    service: 'PRODUCTION',
  });

  return data;
};

export const middlewares = [useEnvironment];
