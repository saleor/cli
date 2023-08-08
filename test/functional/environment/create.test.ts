import { describe, expect, it } from 'vitest';

import {
  command,
  currentDate,
  DefaultTriggerResponse,
  testOrganization,
  testProjectName,
  trigger,
} from '../../helper';

const envName = `test-env-${currentDate()}`;

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
});
