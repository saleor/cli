import { describe, expect, it } from 'vitest';

import {
  command,
  DefaultTriggerResponse,
  prepareEnvironment,
  shouldMockTests,
  testOrganization,
  trigger,
} from '../../helper';
import { API, GET } from '../../../src/lib/index.js';
import { Environment } from '../../../src/types.js';

const newName = 'updated-name';

const getEnvironment = async (envKey: string) => {
  if (shouldMockTests) {
    return {
      key: envKey,
      name: newName,
      maintenance_mode: true,
      protected: true,
    };
  }

  const environment = await (GET(API.Environment, {
    environment: envKey,
    organization: testOrganization,
  }) as Promise<Environment>);

  return environment;
};

describe('update environment', async () => {
  const envKey = await prepareEnvironment();

  it(
    '`env update` updates the environment name',
    async () => {
      const params = [
        'env',
        'update',
        envKey,
        `--name=${newName}`,
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
      expect(environment.name).toBe(newName);
    },
    1000 * 60 * 10,
  );

  it('`env maintenance` enables the maintenance mode', async () => {
    const params = [
      'environment',
      'maintenance',
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
});
