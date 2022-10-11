import fs from 'fs-extra';
import { afterAll, describe, expect, it } from 'vitest';

import { capitalize } from '../../../src/lib/util.js';
import {
  command,
  currentDate,
  DefaultTriggerResponse,
  testOrganization,
  trigger,
} from '../../helper';

const storefrontName = `storefront-${currentDate()}`;
const demoName = capitalize(storefrontName);
const storefrontCwd = `${process.cwd()}/${storefrontName}`;

afterAll(async () => {
  await fs.remove(storefrontCwd);

  await trigger(
    command,
    [
      'project',
      'remove',
      storefrontName,
      `--organization=${testOrganization}`,
      '--force',
    ],
    {}
  );
}, 1000 * 60 * 5);

describe('storefront create --demo', async () => {
  it(
    'should create a demo storefront',
    async () => {
      const params = [
        'storefront',
        'create',
        storefrontName,
        '--demo',
        `--organization=${testOrganization}`,
      ];
      const { exitCode, output } = await trigger(
        command,
        params,
        {},
        { ...DefaultTriggerResponse, ...{ output: [storefrontName] } }
      );

      expect(exitCode).toBe(0);
      expect(output.join()).toContain(storefrontName);
    },
    1000 * 60 * 10
  );
  it(
    'should create a demo project',
    async () => {
      const params = ['project', 'list', `--organization=${testOrganization}`];

      const { exitCode, output } = await trigger(
        command,
        params,
        {},
        { ...DefaultTriggerResponse, ...{ output: [demoName] } }
      );
      expect(exitCode).toBe(0);
      expect(output.join()).toContain(demoName);
    },
    1000 * 60 * 1
  );

  it(
    'should create a demo environment',
    async () => {
      const params = ['env', 'list', `--organization=${testOrganization}`];

      const { exitCode, output } = await trigger(
        command,
        params,
        {},
        { ...DefaultTriggerResponse, ...{ output: [demoName] } }
      );

      expect(exitCode).toBe(0);
      expect(output.join()).toContain(demoName);
    },
    1000 * 60 * 1
  );
});
