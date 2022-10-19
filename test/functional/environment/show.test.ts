import { beforeAll, describe, expect, it } from 'vitest';

import {
  DefaultTriggerResponse,
  prepareEnvironment,
  testOrganization,
  trigger,
} from '../../helper';

beforeAll(async () => {
  await prepareEnvironment();
});

describe('storefront show', async () => {
  const command = 'saleor';
  const key = await prepareEnvironment();

  it('should show the environment details', async () => {
    const params = ['env', 'show', key, `--organization=${testOrganization}`];
    const { exitCode, output } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
        ...{ output: [`key: ${key}`] },
      }
    );

    expect(exitCode).toBe(0);
    expect(output.join()).toContain(`key: ${key}`);
  });

  it('should return 1 exit code for invalid env', async () => {
    const params = ['env', 'show', 'bla', `--organization=${testOrganization}`];
    const { exitCode } = await trigger(
      command,
      params,
      {},
      { ...DefaultTriggerResponse, ...{ exitCode: 1 } }
    );

    expect(exitCode).not.toBe(0);
  });
});
