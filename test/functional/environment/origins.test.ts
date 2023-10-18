import { describe, expect, it } from 'vitest';

import {
  cleanEnvAfterUpdate,
  command,
  DefaultTriggerResponse,
  getEnvironment,
  prepareEnvironment,
  testOrganization,
  trigger,
  waitForBlockingTasks,
} from '../../helper';

const envKey = await prepareEnvironment();

describe('update trusted origins in environment', async () => {
  await waitForBlockingTasks(envKey);

  it('`env origins` update trusted origins in the environment', async () => {
    const params = [
      'env',
      'origins',
      envKey,
      '--origins="https://example.com"',
      '--origins="https://test.com"',
      `--organization=${testOrganization}`,
    ];

    const { exitCode } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
      },
    );
    expect(exitCode).toBe(0);

    const environment = await getEnvironment(envKey);
    expect(environment.allowed_cors_origins).toHaveLength(2);
    expect(environment.allowed_cors_origins).toContain('https://example.com');
  });

  await cleanEnvAfterUpdate(envKey);
});
