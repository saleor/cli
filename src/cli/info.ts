import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import { createRequire } from 'module';
import type { CommandBuilder } from 'yargs';

import packageJson from '../../package.json';
import { header } from '../lib/images.js';

const pkg = packageJson;

const { ux: cli } = CliUx;

const debug = Debug('saleor-cli:info');

export const command = 'info';
export const desc = 'Hello from Saleor';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  header(pkg.version);

  console.log(
    chalk.blue(`
                 _____              _        ______    ____    _____
                / ____|     /\\     | |      |  ____|  / __ \\  |  __ \\
               | (___      /  \\    | |      | |__    | |  | | | |__) |
                \\___ \\    / /\\ \\   | |      |  __|   | |  | | |  _  /
                ____) |  / ____ \\  | |____  | |____  | |__| | | | \\ \\
               |_____/  /_/    \\_\\ |______| |______|  \\____/  |_|  \\_\\
    `)
  );

  console.log(
    chalk.bold.blueBright(`
                     The commerce API that puts developers first
   `)
  );

  console.log('\n');

  cli.url(chalk.blue('Website - https://saleor.io/'), 'https://saleor.io/');
  cli.url(
    chalk.blue('Console - https://cloud.saleor.io/'),
    'https://cloud.saleor.io/'
  );
  cli.url(
    chalk.blue('Github  - https://github.com/saleor/'),
    'https://github.com/saleor/'
  );
};
