import { afterAll, describe, expect, it } from 'vitest';

import {
  command,
  randomString,
  testEnvironmentName,
  testOrganization,
  testProjectName,
  trigger,
} from '../../helper';

const envName = `test-env-${randomString()}`;
const organization = testOrganization;

afterAll(async () => {
  const params = [
    'environment',
    'remove',
    `--organization=${testOrganization}`,
    envName,
    '--force',
  ];
  await trigger(command, params, {});
});

describe('create new environment', async () => {
  it(
    'creates a new environment',
    async () => {
      const params = [
        'env',
        'create',
        testEnvironmentName,
        `--project=${testProjectName}`,
        '--database=sample',
        '--saleor=saleor-master-staging',
        '--domain=saleor-test-domain',
        '--email=test@example.com',
        '--skipRestrict',
        '--deploy',
        `--organization=${organization}`,
      ];
      const { exitCode } = await trigger(command, params, {});
      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );

  it('returns environment list', async () => {
    const params = [
      'environment',
      'list',
      `--organization=${testOrganization}`,
    ];

    const { exitCode } = await trigger(command, params, {});
    expect(exitCode).toBe(0);
  });
});
