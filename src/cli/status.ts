import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import type { CommandBuilder } from 'yargs';

import pkg from '../../package.json';
import { getEnvironment } from '../lib';
import { Config } from '../lib/config.js';

const debug = Debug('saleor-cli:status');

export const command = 'status';
export const desc = 'Show the login status for the systems that CLI depends on';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  debug('checking status');

  const {
    token,
    vercel_token: VercelToken,
    github_token: GitHubToken,
  } = await Config.get();

  const environment = await getEnvironment();

  console.log(`Saleor CLI v${pkg.version}`);
  console.log('');

  console.log(
    ` Saleor API: ${
      token
        ? chalk.green('Logged', '-', environment)
        : `${chalk.red('Not logged')}   Run: saleor login`
    }`
  );

  const vercel = await verifyVercelToken(VercelToken);
  console.log(
    `     Vercel: ${
      vercel
        ? chalk.green('Logged', '-', vercel.user?.username, vercel.user?.email)
        : `${chalk.red('Not logged')}   Run: saleor vercel login`
    }`
  );

  const github = await verifyGithubToken(GitHubToken);
  console.log(
    `     GitHub: ${
      github
        ? chalk.green('Logged', '-', github.login, github.email)
        : `${chalk.red('Not logged')}   Run: saleor github login`
    }`
  );
};

const verifyVercelToken = async (VercelToken: string | undefined) => {
  if (!VercelToken) {
    return null;
  }

  interface Response {
    user: {
      email: string;
      username: string | null;
    };
  }

  try {
    const data: Response = await got
      .get('https://api.vercel.com/v2/user', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: VercelToken,
        },
      })
      .json();

    return data;
  } catch (error) {
    await Config.remove('vercel_token');
    await Config.remove('vercel_team_id');
  }

  return null;
};

const verifyGithubToken = async (GitHubToken: string | undefined) => {
  if (!GitHubToken) {
    return null;
  }
  interface Response {
    email: string;
    login: string | null;
  }

  try {
    const data: Response = await got
      .get('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: GitHubToken,
        },
      })
      .json();

    return data;
  } catch (error) {
    await Config.remove('github_token');
  }

  return null;
};
