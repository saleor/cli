import { beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  prepareEnvironment,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

beforeAll(async () => {
  await prepareEnvironment();
});

describe('show list of existing environments', async () => {
  it('returns environment list', async () => {
    const params = [
      'environment',
      'list',
      `--organization=${testOrganization}`,
    ];

    const { exitCode, output } = await trigger(command, params, {});
    expect(exitCode).toBe(0);
    expect(output).toContain(testEnvironmentName);
  });
});
