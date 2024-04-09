import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import { simpleGit } from 'simple-git';
import { Arguments } from 'yargs';

import { run } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { GitError, obfuscateArgv, printlnSuccess } from '../../lib/util.js';
import { useGithub } from '../../middleware/index.js';

const debug = Debug('saleor-cli:dev:prepare');

export const command = 'prepare [branch|prURL]';
export const desc = 'Build cli from branch or pull request URL';

export const handler = async (argv: Arguments<any>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const git = simpleGit();

  // check if repo is saleor-cli
  debug('check if `prepare` is run from the `saleor-cli` repository');
  try {
    const repo = (await git.remote(['get-url', 'origin'])) as string;
    const repoName = repo.trim().split('/').at(-1);

    if (repoName !== 'saleor-cli.git') {
      console.error(
        chalk.red(
          '\nThis script works only in',
          chalk.bold('saleor-cli'),
          'repository.',
          '\naYour current repository: ',
          chalk.bold(repoName),
        ),
      );
      throw new GitError();
    }
  } catch (err: any) {
    if (err.message.match('not a git repository')) {
      console.error(
        chalk.red(
          '\nThis script works only in',
          chalk.bold('saleor-cli'),
          'repository',
          '\nPlease navigate to your local',
          chalk.bold('saleor-cli'),
          'directory',
        ),
      );
      throw new GitError();
    }

    throw err;
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

    interface GitHubRepository {
      repository: {
        pullRequest: {
          headRefName: string;
        };
      };
    }

    debug('Get the SHA of the PR using GitHub GraphQL API');
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
      .json<{ data: GitHubRepository }>();

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
  console.log('  pnpm build');
  await run('pnpm', ['build'], { cwd: process.cwd() });

  printlnSuccess('prepared');
  console.log('\n  run the saleor cli from project root with:');
  console.log(chalk.green('\n  node ./dist/saleor.js command-name'));
};

export const middlewares = [useGithub];
