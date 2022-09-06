import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { createProject } from '../../lib/util.js';
import { ProjectCreate } from '../../types.js';

const debug = Debug('saleor-cli:project:create');

export const command = 'create [name]';
export const desc = 'Create a new project';

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: false,
    desc: 'name for the new backup',
  })
    .option('plan', {
      type: 'string',
      desc: 'specify the plan',
    })
    .option('region', {
      type: 'string',
      desc: 'specify the region',
    });

export const handler = async (argv: Arguments<ProjectCreate>) => {
  debug(`command arguments: ${JSON.stringify(argv, null, 2)}`);
  await createProject(argv);
};
