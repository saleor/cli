import chalk from 'chalk';
import got from 'got';
import { simpleGit } from 'simple-git';
import { Arguments } from 'yargs';

import { run } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { useGithub } from '../../middleware/index.js';

interface Options {
  branch?: string;
}

export const command = 'prepare [branch|prURL]';
export const desc = 'Build cli from branch or pull request URL';

export const handler = async (argv: Arguments<Options>) => {
  const git = simpleGit();

  // check if repo is saleor-cli
  const repo = (await git.remote(['get-url', 'origin'])) as string;
  if (repo.trim().split('/').at(-1) !== 'saleor-cli.git') {
    console.error(
      chalk.red(
        '\nThis script works only in',
        chalk.bold('saleor-cli'),
        'repository'
      )
    );
    process.exit(1);
  }

  await git.fetch('origin');

  const { branch: url } = argv;

  // PR
  if (url?.match(/https:\/\//)) {
    const { github_token: GitHubToken } = await Config.get();
    const number = parseInt(url.split('/').at(-1) || '0', 10);

    console.log('  getting PR');

    const query = `query getHeadRefName($name: String!, $owner: String!, $number: Int!) {
      repository(name: $name, owner: $owner) {
        pullRequest(number: $number) {
          headRefName
        }
      }
    }`;

    const { data } = await got
      .post('https://api.github.com/graphql', {
        headers: { Authorization: GitHubToken },
        json: {
          query,
          variables: {
            number,
            name: 'saleor-cli',
            owner: 'saleor',
          },
        },
      })
      .json();

    const {
      repository: {
        pullRequest: { headRefName: branch },
      },
    } = data;

    await git.checkout(`origin/${branch}`);
  }

  // branch
  if (url && !url?.match(/https:\/\//)) {
    console.log(`  getting ${url} branch from origin`);
    await git.checkout(`origin/${url}`);
  }

  // no params, using main
  if (!url) {
    console.log('  getting main branch from origin');
    await git.pull('origin', 'main');
  }

  console.log('  pnpm i');
  await run('pnpm', ['i', '--ignore-scripts'], { cwd: process.cwd() });
  console.log('  pnpm compile');
  await run('pnpm', ['compile'], { cwd: process.cwd() });

  console.log(chalk.green('✔️ prepared'));
  console.log('\n  run the saleor cli from project root with:');
  console.log(chalk.green('\n  node ./build/cli.js command-name'));
};

export const middlewares = [useGithub];
