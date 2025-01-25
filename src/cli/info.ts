import { createRequire } from 'node:module';

import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import type { CommandBuilder } from 'yargs';

import { Config } from '../lib/config.js';
import { header } from '../lib/images.js';
import { API, GET, getEnvironment } from '../lib/index.js';
import { Options, User } from '../types.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const debug = Debug('saleor-cli:info');

function hasEmail(unknown: unknown): unknown is { email: string } {
  return typeof unknown === 'object' && unknown !== null && 'email' in unknown;
}

export const command = 'info';
export const desc = 'Hello from Saleor';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  debug('showing status');

  header(pkg.version);

  console.log(
    chalk.blue(`
                 _____              _        ______    ____    _____
                / ____|     /\\     | |      |  ____|  / __ \\  |  __ \\
               | (___      /  \\    | |      | |__    | |  | | | |__) |
                \\___ \\    / /\\ \\   | |      |  __|   | |  | | |  _  /
                ____) |  / ____ \\  | |____  | |____  | |__| | | | \\ \\
               |_____/  /_/    \\_\\ |______| |______|  \\____/  |_|  \\_\\
    `),
  );

  console.log(
    chalk.bold.blueBright(`
                     The commerce API that puts developers first
   `),
  );

  console.log('\n');

  const { ux: cli } = CliUx;

  cli.url(chalk.blue('Website - https://saleor.io/'), 'https://saleor.io/');
  cli.url(
    chalk.blue('Console - https://cloud.saleor.io/'),
    'https://cloud.saleor.io/',
  );
  cli.url(
    chalk.blue('Github  - https://github.com/saleor/'),
    'https://github.com/saleor/',
  );

  console.log('');

  try {
    const { token } = await Config.get();
    const user = (await GET(API.User, { token } as Options)) as User;

    if (hasEmail(user)) {
      const environment = await getEnvironment();
      console.log(
        chalk.green(
          'Hello',
          user.email,
          'you\'re logged in to Saleor API -',
          environment,
        ),
      );
    }
  } catch (e) {
    console.log(chalk.blue('You\'re not logged in'));
    console.log('  To log in run:');
    console.log('    saleor login');
  }

  console.log('');
};
