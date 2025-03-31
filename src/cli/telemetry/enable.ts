import Debug from 'debug';

import { NoCommandBuilderSetup } from '../../lib/index.js';

export const command = 'enable';
export const desc = 'Enable the telemetry';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  console.log(
    'Telemetry is disabled permanently. This command is deprecated and will be removed.',
  );
};
