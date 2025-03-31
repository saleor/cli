import { NoCommandBuilderSetup } from '../../lib/index.js';

export const command = ['status', '$0'];
export const desc = 'Show the telemetry status';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  console.log(
    'Telemetry is disabled. This command is deprecated and will be removed.',
  );
};
