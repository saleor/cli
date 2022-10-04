import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../lib/config.js';
import { API, GET } from '../lib/index.js';
import {
  obfuscateArgv,
  promptEnvironment,
  promptOrganization,
} from '../lib/util.js';
import { Options } from '../types.js';

const { ux: cli } = CliUx;

const debug = Debug('saleor-cli:configure');

export const command = 'configure [token]';
export const desc = 'Configure Saleor CLI';

export const builder: CommandBuilder = (_) =>
  _.positional('token', { type: 'string', demandOption: false }).option(
    'force',
    {
      type: 'boolean',
      desc: 'skip additional prompts',
    }
  );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { token, force } = argv;
  const legitToken = await configure(token);

  console.log(`
Saleor Telemetry is ${chalk.underline(
    'completely anonymous and optional'
  )} information about general usage.
You may opt-out at any time (check 'saleor telemetry').
Learn more: ${chalk.gray('https://saleor.io/')}${chalk.blueBright('telemetry')}
  `);

  if (force) {
    process.exit(0);
  }

  const { telemetry } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'telemetry',
    initial: 'yes',
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
    message: 'Are you OK with leaving telemetry enabled?',
  })) as { telemetry: boolean };

  if (!telemetry) {
    await Config.set('telemetry', 'false');
  }

  await chooseOrganization(legitToken);
};

const validateToken = async (token: string) => {
  const user = (await GET(API.User, { token: `Token ${token}` })) as any;
  console.log(`${chalk.green('Success')}. Logged as ${user.email}\n`);
};

const chooseOrganization = async (token: string | undefined) => {
  const organizations = (await GET(API.Organization, { token })) as any[];

  if (organizations.length) {
    const { orgSetup } = (await Enquirer.prompt({
      type: 'confirm',
      name: 'orgSetup',
      initial: 'yes',
      format: (value) => chalk.cyan(value ? 'yes' : 'no'),
      message: 'Would you like to choose the default organization?',
    })) as { orgSetup: boolean };

    if (orgSetup) {
      const organization = await promptOrganization({ token });
      await chooseEnv(token, organization.value);
    }
  }
};

const chooseEnv = async (
  token: string | undefined,
  organizationSlug: string
) => {
  const envs = (await GET(API.Environment, {
    token,
    organization: organizationSlug,
  })) as any[];

  if (envs.length) {
    const { envSetup } = (await Enquirer.prompt({
      type: 'confirm',
      name: 'envSetup',
      initial: 'yes',
      format: (value) => chalk.cyan(value ? 'yes' : 'no'),
      message: 'Would you like to choose the default environment',
    })) as { envSetup: boolean };

    if (envSetup) {
      const env = await promptEnvironment({
        token,
        organization: organizationSlug,
      });
      await Config.set('environment_id', env.value);
    }
  }
};

export const configure = async (providedToken: string | undefined) => {
  let token = providedToken;
  while (!token) token = await cli.prompt('Access Token', { type: 'mask' });

  await validateToken(token);
  Config.reset();
  const header = `Token ${token}`;
  await Config.set('token', header);
  return header;
};
