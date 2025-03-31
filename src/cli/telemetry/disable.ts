import { NoCommandBuilderSetup } from '../../lib/index.js';

export const command = 'disable';
export const desc = 'Disable the telemetry';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  console.log(
    'Telemetry is disabled permanently. This command is deprecated and will be removed.',
  );
};
