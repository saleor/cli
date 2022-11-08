import chalk from 'chalk';
import Debug from 'debug';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { API, GET } from '../../lib/index.js';
import {
  obfuscateArgv,
  printlnSuccess,
  promptOrganization,
} from '../../lib/util.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:org:switch');

export const command = 'switch [slug]';
export const desc = 'Make the provided organization the default one';

export const builder: CommandBuilder = (_) =>
  _.positional('slug', {
    type: 'string',
    demandOption: false,
    desc: 'slug of the organization',
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const organization = await getOrganization(argv);

  await Config.set('organization_slug', organization.value);
  await Config.remove('environment_id');

  printlnSuccess(
    chalk(chalk.bold('Organization ·'), chalk.cyan(organization.value))
  );
};

const getOrganization = async (argv: Arguments<Options>) => {
  if (!argv.slug) {
    const data = await promptOrganization(argv);
    return data;
  }

  const organizations = (await GET(API.Organization, argv)) as any[];

  if (!organizations.map((o) => o.slug).includes(argv.slug)) {
    console.error(chalk.red(`No organization with slug ${argv.slug} found`));
    process.exit(1);
  }

  return { name: argv.slug, value: argv.slug };
};
