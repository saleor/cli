import { beforeAll, describe, expect, it } from 'vitest';

import {
  clearProjects,
  command,
  currentDate,
  DefaultTriggerResponse,
  prepareEnvironment,
  testOrganization,
  testProjectName,
  trigger,
} from '../../helper';

const envName = `test-env-${currentDate()}`;

beforeAll(
  async () => {
    await clearProjects(true);
    await prepareEnvironment();
  },
  1000 * 60 * 5,
);

describe('create new environment', async () => {
  it(
    'creates a new environment',
    async () => {
      const params = [
        'env',
        'create',
        envName,
        `--project=${testProjectName}`,
        '--database=sample',
        '--saleor=saleor-master-staging',
        `--domain=${envName}`,
        '--skip-restrict',
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(command, params, {});
      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10,
  );

  it('`env list` contains newly created env', async () => {
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
        ...{ output: [envName] },
      },
    );
    expect(exitCode).toBe(0);
    expect(output.join()).toContain(envName);
  });

  it('`environment show` returns env details', async () => {
    const params = [
      'environment',
      'show',
      envName,
      `--organization=${testOrganization}`,
    ];

    const { exitCode, output } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
        ...{
          output: [
            `name: ${envName}`,
            `domain: ${envName}.staging.saleor.cloud`,
            'database_population: sample',
          ],
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(output.join()).toContain(`name: ${envName}`);
    expect(output.join()).toContain(`domain: ${envName}`);
    expect(output.join()).toContain('database_population: sample');
  });

  it('`environment remove` removes environment', async () => {
    const params = [
      'environment',
      'remove',
      envName,
      `--organization=${testOrganization}`,
      '--force',
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
  });

  it('`env list` does not contain newly created env after removal', async () => {
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
      },
    );
    expect(exitCode).toBe(0);
    expect(output.join()).not.toContain(envName);
  });
});
