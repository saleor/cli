import pkg from '../../../package.json';
import { run } from '../../lib/common.js';

export const command = 'info';
export const desc = 'Show env info for debugging';

export const handler = async () => {
  console.log(`Saleor CLI v${pkg.version}`);

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
