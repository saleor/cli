import fs from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  currentDate,
  prepareEnvironment,
  removeGithubRepository,
  removeVercelProject,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

const storefrontName = `storefront-${currentDate()}`;
const checkoutName = `${storefrontName}-app-checkout`;
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

  console.log('Storefront prepared');
}, 1000 * 60 * 10);

afterAll(async () => {
  await removeGithubRepository(storefrontName, storefrontCwd);
  await removeGithubRepository(checkoutName, storefrontCwd);
  await removeVercelProject(storefrontName);
  await removeVercelProject(checkoutName);
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
      const { exitCode } = await trigger(command, params, {
        cwd: storefrontCwd,
      });

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
      const { exitCode } = await trigger(command, params, {
        cwd: storefrontCwd,
      });

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );
});
