import chalk from 'chalk';
import Debug from 'debug';
import type { CommandBuilder } from 'yargs';

import pkg from '../../package.json';
import { Config } from '../lib/config.js';

const debug = Debug('saleor-cli:status');

export const command = 'status';
export const desc = 'Show the login status for the systems that CLI depends on';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  const {
    token,
    vercel_token: vercel,
    github_token: github,
  } = await Config.get();

  console.log(`Saleor CLI v${pkg.version}`);
  console.log('');

  console.log(
    ` Saleor API: ${
      token
        ? chalk.green('Logged')
        : `${chalk.red('Not logged')}   Run: saleor login`
    }`
  );
  console.log(
    `     Vercel: ${
      vercel
        ? chalk.green('Logged')
        : `${chalk.red('Not logged')}   Run: saleor vercel login`
    }`
  );
  console.log(
    `     GitHub: ${
      github
        ? chalk.green('Logged')
        : `${chalk.red('Not logged')}   Run: saleor github login`
    }`
  );
};
