import chalk from 'chalk';
import type { Arguments, CommandBuilder } from 'yargs';

import { API, DELETE } from '../../lib/index.js';
import { confirmRemoval, promptProject } from '../../lib/util.js';
import { Options } from '../../types.js';

export const command = 'remove [slug]';
export const desc = 'Remove the project';

export const builder: CommandBuilder = (_) =>
  _.positional('slug', {
    type: 'string',
    demandOption: false,
    desc: 'slug of the project',
  }).option('force', {
    type: 'boolean',
    desc: 'skip confrimation prompt',
  });

export const handler = async (argv: Arguments<Options>) => {
  const project = argv.slug
    ? { name: argv.slug, value: argv.slug }
    : await promptProject(argv);
  const proceed = await confirmRemoval(argv, `project ${project.name}`);

  if (proceed) {
    (await DELETE(API.Project, { ...argv, project: project.value })) as any;
    console.log(
      chalk.green('✔'),
      chalk.bold('Project has been successfuly removed')
    );
  }
};
