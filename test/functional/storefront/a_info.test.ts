import { expect, it } from 'vitest';

import { command, trigger } from '../../helper';

it('should return 0 for info command', async () => {
  const params = ['info'];
  const { exitCode } = await trigger(command, params, {});

  expect(exitCode).toBe(0);
});
