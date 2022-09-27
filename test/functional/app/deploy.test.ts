import crypto from 'crypto';
import fs from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

const rand = crypto.randomBytes(256).toString('hex').substring(0, 7);
const appName = `test-app-${rand}`;
const storefrontCwd = `${process.cwd()}/${appName}`;

beforeAll(async () => {
  const params = ['app', 'create', appName];
  console.log(`creating an app ${appName}`);
  await trigger(command, params, {});
}, 1000 * 600);

afterAll(async () => {
  await fs.remove(storefrontCwd);
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
        cwd: storefrontCwd,
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
        cwd: storefrontCwd,
      });

      expect(exitCode).toBe(0);
    },
    1000 * 60 * 10
  );
});
