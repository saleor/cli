import chalk from 'chalk';
import Debug from 'debug';

import { Config } from '../../lib/config.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';

const debug = Debug('saleor-cli:telemetry:enable');

export const command = 'enable';
export const desc = 'Enable the telemetry';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  console.log(`${chalk.gray('Saleor Commerce CLI')} · Telemetry\n`);

  Config.remove('telemetry');

  console.log(`Status: ${chalk.green('Enabled')}`);

  console.log(`
Saleor Telemetry is ${chalk.underline(
    'anonymous'
  )}. Thank you for participating!
Learn more: ${chalk.gray('https://saleor.io/')}${chalk.blueBright('telemetry')}
  `);
};
