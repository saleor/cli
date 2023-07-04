import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  DefaultTriggerResponse,
  prepareEnvironment,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

const appName = `${testEnvironmentName}-app`;

beforeAll(async () => {
  await prepareEnvironment();
}, 1000 * 60 * 10);

afterAll(async () => {
  await removeApps();
}, 1000 * 60 * 1);

describe('app create', async () => {
  it(
    'should create a Saleor Local App',
    async () => {
      const params = [
        'app',
        'create',
        appName,
        '--permissions=MANAGE_USERS',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode, output } = await trigger(
        command,
        params,
        {},
        {
          ...DefaultTriggerResponse,
          ...{ output: ['App created with id'] },
        }
      );

      expect(exitCode).toBe(0);
      expect(output.join()).toContain('App created with id');
    },
    1000 * 60 * 1
  );
});

const getApps = async () => {
  const params = [
    'app',
    'list',
    `--environment=${testEnvironmentName}`,
    `--organization=${testOrganization}`,
    '--json',
  ];

  const { output } = await trigger(
    command,
    params,
    {},
    {
      ...DefaultTriggerResponse,
      ...{ output: ['[]'] },
    }
  );

  console.log(output);
  return JSON.parse(output.join());
};

const removeApps = async () => {
  const apps = await getApps();

  for (const app of apps) {
    const params = [
      'app',
      'remove',
      app.id,
      `--environment=${testEnvironmentName}`,
      `--organization=${testOrganization}`,
      '--force',
    ];

    console.log(`removing backup ${app.id} - ${app.name}`);
    await trigger(command, params, {});
  }
};
