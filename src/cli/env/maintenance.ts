import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import Enquirer from 'enquirer';
import { getEnvironment } from '../../lib/environment.js';
import { API, PATCH } from '../../lib/index.js';
import { obfuscateArgv, println, printlnSuccess } from '../../lib/util.js';
import {
  useBlockingTasksChecker,
  useEnvironment,
} from '../../middleware/index.js';
import { EnvironmentMaintenance } from '../../types.js';

const debug = Debug('saleor-cli:env:maintanance');

export const command = 'maintenance [key|environment]';
export const desc =
  'Enable or disable maintenance mode in a specific environment';

export const builder: CommandBuilder = (_) =>
  _.positional('key', {
    type: 'string',
    demandOption: false,
    desc: 'key of the environment',
  })
    .option('enable', {
      type: 'boolean',
      demandOption: false,
      desc: 'enable maintenance mode',
    })
    .option('disable', {
      type: 'boolean',
      demandOption: false,
      desc: 'disable maintenance mode',
    })
    .example('saleor env maintenance', '')
    .example('saleor env maintenance my-environment', '')
    .example('saleor env maintenance my-environment --enable', '')
    .example('saleor env maintenance my-environment --disable', '');

export const handler = async (argv: Arguments<EnvironmentMaintenance>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const { enable, disable } = argv;

  if (disable !== undefined) {
    await updateEnvironment(argv, { maintenance_mode: false });
  }

  if (enable !== undefined) {
    await updateEnvironment(argv, { maintenance_mode: true });
  }

  const { maintenanceMode } = await Enquirer.prompt<{
    maintenanceMode: string;
  }>({
    type: 'select',
    name: 'maintenanceMode',
    choices: [
      { message: 'disable maintenance mode', name: 'disable' },
      { message: 'enable maintenance mode', name: 'enable' },
    ],
    message: 'Choose an option',
  });

  await updateEnvironment(argv, {
    maintenance_mode: maintenanceMode === 'enable',
  });
};

const updateEnvironment = async (
  argv: Arguments<EnvironmentMaintenance>,
  json: { maintenance_mode: boolean },
) => {
  const { maintenance_mode: maintenanceMode } = await getEnvironment(argv);
  const mode = json.maintenance_mode ? 'enabled' : 'disabled';

  if (maintenanceMode === json.maintenance_mode) {
    println(`Maintenance mode is already ${mode}`);
    process.exit(0);
  }

  await PATCH(API.Environment, argv, {
    json,
  });

  printlnSuccess(`Maintenance mode is ${mode}`);
  process.exit(0);
};

export const middlewares = [useEnvironment, useBlockingTasksChecker];
