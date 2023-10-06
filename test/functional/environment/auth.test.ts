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
  removeEnvironment,
} from '../../helper';

const envKey = await prepareEnvironment();

afterAll(async () => removeEnvironment(envKey));

describe('update auth in environment', async () => {
  await waitForBlockingTasks(envKey);

  it('`env auth` enables the basic auth on the environment', async () => {
    const params = [
      'env',
      'auth',
      envKey,
      '--login=saleor',
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
    expect(environment.protected).toBeTruthy();
  });

  await cleanEnvAfterUpdate(envKey);
});
