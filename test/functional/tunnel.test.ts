import { spawn } from 'child_process';
import fs from 'fs-extra';
import got from 'got';
import path from 'path';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { Manifest } from '../../src/lib/common';
import { delay } from '../../src/lib/util';
import {
  command,
  prepareEnvironment,
  shouldMockTests,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../helper';

const appName = 'tunnel-app';
const appCwd = `${process.cwd()}/${appName}`;

beforeAll(async () => {
  await prepareEnvironment();
  const params = ['app', 'create', appName];
  console.log(`creating an app ${appName}`);

  await trigger(command, params, {});
}, 1000 * 60 * 10);

afterAll(async () => {
  await fs.remove(path.join(process.cwd(), appCwd));
});

it(
  'should start the tunnel and verify if provided URL is accessible',
  async () => {
    if (shouldMockTests) {
      return;
    }

    const params = [
      'app',
      'tunnel',
      `--organization=${testOrganization}`,
      `--environment=${testEnvironmentName}`,
      '--force-install',
    ];

    const app = spawn('pnpm', ['dev'], { cwd: appCwd });

    // wait for the app to start
    await delay(1000 * 30);

    const tunnel = spawn('saleor', params, { cwd: appCwd });

    const output: string[] = [];
    tunnel.stdout.on('data', (data) => {
      output.push(data.toString());
    });

    tunnel.stderr.on('data', (data) => {
      if (data.toString().match('✔ Installing')) {
        const tunnelUrl = output.join().match('https.*.saleor.live');

        if (!tunnelUrl) {
          throw new Error('Tunnel URL not found');
        }

        console.log(`Tunnel URL: ${tunnelUrl[0]}`);

        checkTunnelUrl(tunnelUrl[0]);
        checkManifestName(tunnelUrl[0]);
      }
    });

    // wait for the tunnel to start
    await delay(1000 * 60 * 2);
    console.log('closing');
    tunnel.emit('close');
    app.emit('close');
  },
  1000 * 60 * 3
);

const checkTunnelUrl = async (tunnelUrl: string) => {
  const { statusCode } = await got.get(tunnelUrl[0]);
  expect(statusCode).toBe(200);
};

const checkManifestName = async (tunnelUrl: string) => {
  const manifest: Manifest = await got.get(`${tunnelUrl}/api/manifest`).json();

  expect(manifest.name).toBe(appName);
};
