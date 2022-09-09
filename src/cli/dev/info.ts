import { createRequire } from 'module';

import { run } from '../../lib/common.js';

export const command = 'info';
export const desc = 'Show env info for debugging';

export const handler = async () => {
  const require = createRequire(import.meta.url);
  const pkg = require('../../../package.json');

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
