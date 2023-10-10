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

describe('update maintenance mode in the environment', async () => {
  await waitForBlockingTasks(envKey);

  it('`env maintenance` enables the maintenance mode', async () => {
    const params = [
      'env',
      'maintenance',
      envKey,
      '--enable',
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
    expect(environment.maintenance_mode).toBeTruthy();
  });

  await cleanEnvAfterUpdate(envKey);
});
