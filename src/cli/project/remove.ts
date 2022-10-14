import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, DELETE } from '../../lib/index.js';
import {
  confirmRemoval,
  obfuscateArgv,
  promptProject,
} from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:project:remove');

export const command = 'remove [slug]';
export const desc = 'Remove the project';

export const builder: CommandBuilder = (_) =>
  _.positional('slug', {
    type: 'string',
    demandOption: false,
    desc: 'slug of the project',
  }).option('force', {
    type: 'boolean',
    desc: 'skip confirmation prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const project = argv.slug
    ? { name: argv.slug, value: argv.slug }
    : await promptProject(argv);
  const proceed = await confirmRemoval(argv, `project ${project.name}`);

  if (proceed) {
    (await DELETE(API.Project, { ...argv, project: project.value })) as any;
    console.log(
      chalk.green('✔'),
      chalk.bold('Project has been successfully removed')
    );
  }
};
