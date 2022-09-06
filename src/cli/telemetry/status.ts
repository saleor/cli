import chalk from 'chalk';
import Debug from 'debug';

import { Config } from '../../lib/config.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';

const debug = Debug('saleor-cli:telemetry:status');

export const command = ['status', '$0'];
export const desc = 'Show the telemetry status';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  console.log(`${chalk.gray('Saleor Commerce CLI')} · Telemetry\n`);
  const { telemetry } = await Config.get();
  const isTelemetryEnabled = telemetry === undefined;

  const message = isTelemetryEnabled
    ? `${chalk.green('Enabled')}`
    : `${chalk.red('Disabled')}`;
  console.log(`Status: ${message}`);
};
