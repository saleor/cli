import { describe, expect, it } from 'vitest';

import { DefaultTriggerResponse, testOrganization, trigger } from '../helper';

describe('show organization details', async () => {
  const command = 'saleor';

  it('shows organization details', async () => {
    const params = ['organization', 'show', testOrganization];

    const { exitCode, output } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
        ...{
          output: [`slug: ${testOrganization}`],
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(output.join()).toContain(`slug: ${testOrganization}`);
  });

  it('should return 1 exit code for invalid organization', async () => {
    const params = ['organization', 'show', 'invalid'];
    const { exitCode } = await trigger(
      command,
      params,
      {},
      { ...DefaultTriggerResponse, ...{ exitCode: 1 } },
    );

    expect(exitCode).not.toBe(0);
  });
});
