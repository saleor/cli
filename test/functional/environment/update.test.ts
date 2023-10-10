import { describe, expect, it, afterAll } from 'vitest';

import {
  cleanEnvAfterUpdate,
  command,
  DefaultTriggerResponse,
  getEnvironment,
  newTestEnvironmentName,
  prepareEnvironment,
  testOrganization,
  trigger,
  waitForBlockingTasks,
} from '../../helper';

const envKey = await prepareEnvironment();

describe('update environment', async () => {
  await waitForBlockingTasks(envKey);

  it(
    '`env update` updates the environment name',
    async () => {
      const params = [
        'env',
        'update',
        envKey,
        `--name=${newTestEnvironmentName}`,
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
      expect(environment.name).toBe(newTestEnvironmentName);
    },
    1000 * 60 * 10,
  );

  await cleanEnvAfterUpdate(envKey);
});
