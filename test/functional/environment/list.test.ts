import { beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  DefaultTriggerResponse,
  prepareEnvironment,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

beforeAll(async () => {
  await prepareEnvironment();
});

describe('show list of existing environments', async () => {
  it('returns environment list', async () => {
    const params = [
      'environment',
      'list',
      `--organization=${testOrganization}`,
    ];

    const { exitCode, output } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
        ...{ output: [testEnvironmentName] },
      }
    );

    expect(exitCode).toBe(0);
    expect(output.join()).toContain(testEnvironmentName);
  });
});
