import chalk from 'chalk';
import type { CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';

export const command = ['status', '$0'];
export const desc = 'Show the telemetry status';

export const builder: CommandBuilder = (_) => _;

export const handler = async () => {
  console.log(`${chalk.gray('Saleor Commerce CLI')} · Telemetry\n`);
  const { telemetry } = await Config.get();
  const isTelemetryEnabled = telemetry === undefined;

  const message = isTelemetryEnabled
    ? `${chalk.green('Enabled')}`
    : `${chalk.red('Disabled')}`;
  console.log(`Status: ${message}`);
};
