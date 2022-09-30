import { describe, expect, it } from 'vitest';

import { command, testOrganization, trigger } from '../../helper';

describe('show list of existing environments', async () => {
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
