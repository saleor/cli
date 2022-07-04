import chalk from 'chalk';
import type { CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';

export const command = 'disable';
export const desc = 'Disable the telemetry';

export const builder: CommandBuilder = (_) => _;

export const handler = async () => {
  console.log(`${chalk.gray('Saleor Commerce CLI')} · Telemetry\n`);

  await Config.set('telemetry', 'false');

  console.log(`${chalk.bold('Status:')} ${chalk.red('Disabled')}`);

  console.log(`
You have opted-out of our ${chalk.underline(
    'anonymous'
  )} telemetry program. We won't be collecting data from your machine.
Learn more: ${chalk.gray('https://saleor.io/')}${chalk.blueBright('telemetry')}
  `);
};
