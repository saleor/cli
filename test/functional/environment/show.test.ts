import { beforeAll, describe, expect, it } from 'vitest';

import {
  DefaultTriggerResponse,
  prepareEnvironment,
  testEnvironmentName,
  trigger,
} from '../../helper';

beforeAll(async () => {
  await prepareEnvironment();
});

describe('storefront show', async () => {
  const command = 'saleor';

  it('should return 0 exit code for valid env', async () => {
    const params = ['env', 'show', testEnvironmentName];
    const { exitCode } = await trigger(command, params, {});

    expect(exitCode).toBe(0);
  });

  it('should return 1 exit code for invalid env', async () => {
    const params = ['env', 'show', 'bla'];
    const { exitCode } = await trigger(
      command,
      params,
      {},
      { ...DefaultTriggerResponse, ...{ exitCode: 1 } }
    );

    expect(exitCode).not.toBe(0);
  });
});
