import { run } from '../../lib/common.js';

export const command = 'info';
export const desc = 'Show env info for debugging';

export const handler = async () => {
  await run(
    'npx',
    [
      'envinfo',
      '--system',
      '--binaries',
      '--browsers',
      '--npmPackages',
      '{saleor,@saleor/*}',
    ],
    { cwd: process.cwd() },
    true
  );
};
