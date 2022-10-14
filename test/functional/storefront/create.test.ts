import fs from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { capitalize } from '../../../src/lib/util.js';
import {
  clearProjects,
  command,
  currentDate,
  DefaultTriggerResponse,
  removeProject,
  testOrganization,
  trigger,
} from '../../helper';

const storefrontName = `storefront-${currentDate()}`;
const demoName = capitalize(storefrontName);
const storefrontCwd = `${process.cwd()}/${storefrontName}`;

beforeAll(async () => {
  await clearProjects();
});

afterAll(async () => {
  await fs.remove(storefrontCwd);

  await removeProject(storefrontName);
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
