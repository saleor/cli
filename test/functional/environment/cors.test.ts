import { describe, expect, it, afterAll } from 'vitest';

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

describe('update CORS origins in environment', async () => {
  await waitForBlockingTasks(envKey);

  it('`env cors` updates the environments CORS origins', async () => {
    const params = [
      'env',
      'cors',
      envKey,
      '--selected="https://example.com"',
      '--selected="https://test.com"',
      '--password=saleor',
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
