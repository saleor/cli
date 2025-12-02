import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import type { CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { contentBox, delay, printlnSuccess } from '../../lib/util.js';
import {
  GithubLoginDeviceCodeResponse,
  GithubLoginDeviceResponse,
} from '../../types.js';

const debug = Debug('saleor-cli:github:login');

export const command = 'login';
export const desc = 'Add integration for Saleor CLI';

export const builder: CommandBuilder = (_) => _;

export const handler = async () => {
  const { GithubClientID } = await Config.get();

  const {
    user_code: userCode,
    device_code: deviceCode,
    verification_uri: verificationUri,
    interval,
    expires_in: expiresIn,
  } = (await got
    .post('https://github.com/login/device/code', {
      json: {
        client_id: GithubClientID,
        scope: 'repo',
      },
    })
    .json()) as GithubLoginDeviceResponse;

  contentBox(`
    ${chalk.bold('Please open the following URL in your browser:')}

    ${verificationUri}

    ${chalk('And enter the following code:', chalk.bold(userCode))}`);

  const pollForAccessToken = async () => {
    const { access_token: accessToken } = (await got
      .post('https://github.com/login/oauth/access_token', {
        json: {
          client_id: GithubClientID,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
        },
      })
      .json()) as GithubLoginDeviceCodeResponse;

    if (accessToken) {
      await Config.set('github_token', `Bearer ${accessToken}`);
      printlnSuccess(
        chalk.bold(
          "You've successfully authenticated GitHub with the Saleor CLI!",
        ),
      );
      process.exit(0);
    }
  };

  const expiry = Date.now() - expiresIn * 1000;

  do {
    debug(Date.now());
    await delay(interval * 1000);

    try {
      await pollForAccessToken();
    } catch {
      return;
    }
  } while (Date.now() > expiry);
};
