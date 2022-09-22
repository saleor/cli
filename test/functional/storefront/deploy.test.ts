import crypto from 'crypto';
import fs from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  prepareEnvironment,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

const rand = crypto.randomBytes(256).toString('hex').substring(0, 7);
const storefrontName = `storefront-${rand}`;
const storefrontCwd = `${process.cwd()}/${storefrontName}`;

beforeAll(async () => {
  const environment = await prepareEnvironment();

  const params = [
    'store',
    'create',
    storefrontName,
    `--environment=${environment}`,
  ];
  console.log(
    `creating storefront ${storefrontName} with the ${environment} env`
  );
  await trigger(command, params, {});
}, 1000 * 60 * 10);

afterAll(async () => {
  await fs.remove(storefrontCwd);
}, 1000 * 60 * 10);

describe('storefront deploy', async () => {
  it(
    'should deploy a storefront with checkout to Vercel',
    async () => {
      const params = [
        'storefront',
        'deploy',
        '--with-checkout',
        '--no-github-prompt',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(
        command,
        params,
        { cwd: storefrontCwd },
        0
      );

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 20
  );

  it(
    'should re-deploy storefront with checkout to Vercel',
    async () => {
      const params = [
        'storefront',
        'deploy',
        '--with-checkout',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(
        command,
        params,
        { cwd: storefrontCwd },
        0
      );

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );
});
