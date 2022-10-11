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
  await removeGithubRepository(storefrontName, storefrontCwd);
  await removeVercelProject(`${storefrontName}-app-checkout`);
  await fs.remove(storefrontCwd);
}, 1000 * 60 * 10);

describe('checkout deploy', async () => {
  it(
    'should deploy a checkout to Vercel',
    async () => {
      const params = [
        'checkout',
        'deploy',
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
    'should re-deploy checkout with checkout to Vercel',
    async () => {
      const params = [
        'checkout',
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
