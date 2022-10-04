import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { getEnvironment } from '../../lib/environment.js';
import { API, PUT } from '../../lib/index.js';
import {
  obfuscateArgv,
  promptCompatibleVersion,
  waitForTask,
} from '../../lib/util.js';
import { useEnvironment } from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:env:upgrade');

export const command = 'upgrade [key|environment]';
export const desc = 'Upgrade a Saleor version in a specific environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const env = await getEnvironment(argv);
  const service = await promptCompatibleVersion({
    ...argv,
    region: env.service.region,
    serviceName: `?compatible_with=${env.service.version}`,
  });

  const result = (await PUT(API.UpgradeEnvironment, argv, {
    json: { service: service.value },
  })) as any;
  await waitForTask(
    argv,
    result.task_id,
    'Upgrading',
    'Yay! Upgrade finished!'
  );
};

export const middlewares = [useEnvironment];
