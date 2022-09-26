import { describe, expect, it } from 'vitest';

import { command, randomString, testOrganization, trigger } from '../../helper';

describe('project list', async () => {
  const projectName = `test-project-${randomString()}`;

  it('returns project list', async () => {
    const params = ['project', 'list', `--organization=${testOrganization}`];

    const { exitCode } = await trigger(command, params, {}, 0);
    expect(exitCode).toBe(0);
  });
});
