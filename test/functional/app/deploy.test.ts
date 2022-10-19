import fs from 'fs-extra';
import got from 'got';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Manifest } from '../../../src/lib/common';
import { Config } from '../../../src/lib/config';
import { Vercel } from '../../../src/lib/vercel.js';
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

const appName = `test-app-${currentDate()}`;
const appCwd = `${process.cwd()}/${appName}`;

beforeAll(async () => {
  await prepareEnvironment();
  const params = ['app', 'create', appName];
  console.log(`creating an app ${appName}`);
  await trigger(command, params, {});
}, 1000 * 600);

afterAll(async () => {
  await removeGithubRepository(appName, appCwd);
  await removeVercelProject(appName);
  await fs.remove(appCwd);
});

describe('app deploy', async () => {
  it(
    'should deploy an app to Vercel',
    async () => {
      const params = [
        'app',
        'deploy',
        '--no-github-prompt',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(command, params, {
        cwd: appCwd,
      });

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );

  it(
    'should re-deploy an app to Vercel',
    async () => {
      const params = [
        'app',
        'deploy',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(command, params, {
        cwd: appCwd,
      });

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );

  it('the deployed app returns the manifest', async () => {
    const { vercel_token: VercelToken } = await Config.get();
    const vercel = new Vercel(VercelToken);
    const domain = vercel.getProjectDomain(appName);
    const manifest: Manifest = await got.get(`https://${domain}`).json();

    expect(manifest.name).toBe(appName);
  });
});
