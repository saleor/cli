/* eslint-disable import/no-extraneous-dependencies */
import fs from 'fs-extra';
import { beforeEach, describe, expect, it } from 'vitest';

import { verifyEnvVarPresence } from './common';

beforeEach(async () => {
  await fs.remove('.env');
});

describe('verifyEnvVarPresence', () => {
  it('should throw an error if `.env` file is not found', async () => {
    await expect(verifyEnvVarPresence()).rejects.toThrowError(
      /No \.env file found/
    );
  });

  it('should throw an error if NEXT_PUBLIC_SALEOR_HOST_URL is not found in `env file', async () => {
    await fs.createFile('.env');

    await expect(verifyEnvVarPresence()).rejects.toThrowError(
      /No NEXT_PUBLIC_SALEOR_HOST_URL variable found/
    );
  });

  it('should throw an error if NEXT_PUBLIC_SALEOR_HOST_URL is invalid', async () => {
    await fs.createFile('.env');
    await fs.writeFile('.env', 'NEXT_PUBLIC_SALEOR_HOST_URL=test');

    await expect(verifyEnvVarPresence()).rejects.toThrowError(
      /Cannot verify the environment's graphql endpoint/
    );
  });
});
