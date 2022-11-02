import chalk from 'chalk';
import Debug from 'debug';
import { access } from 'fs/promises';
import got from 'got';
import kebabCase from 'lodash.kebabcase';
import ora, { Ora } from 'ora';
import path from 'path';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import { simpleGit } from 'simple-git';
import { Arguments, CommandBuilder } from 'yargs';

import * as Configs from '../../config.js';
import { run } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { gitCopy, gitCopySha } from '../../lib/download.js';
import {
  checkPnpmPresence,
  contentBox,
  obfuscateArgv,
  print,
} from '../../lib/util.js';
import { useToken } from '../../middleware/index.js';
import { StoreCreate } from '../../types.js';

const debug = Debug('saleor-cli:app:create');

export const command = 'create [name]';
export const desc = 'Create a Saleor App template';

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: true,
    default: 'my-saleor-app',
  })
    .option('dependencies', {
      type: 'boolean',
      default: true,
      alias: 'deps',
    })
    .option('template', {
      type: 'string',
      default: Configs.SaleorAppRepo,
      alias: ['t', 'repo', 'repository'],
    })
    .option('branch', {
      type: 'string',
      default: Configs.SaleorAppDefaultBranch,
      alias: 'b',
    })
    .option('example', {
      type: 'string',
      alias: 'e',
    });

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  debug('command arguments: %O', obfuscateArgv(argv));

  debug('check PNPM presence');
  await checkPnpmPresence('This Saleor App template');

  const { name, template, branch, example } = argv;

  debug('construct the folder name');
  const target = await getFolderName(sanitize(name));
  const packageName = kebabCase(target);
  const dirMsg = `App directory: ${chalk.blue(
    path.join(process.env.PWD || '.', target)
  )}`;
  const appMsg = ` Package name: ${chalk.blue(packageName)}`;

  contentBox(`    ${dirMsg}\n    ${appMsg}`);

  const spinner = ora('Downloading...').start();

  debug(`downloading the ${branch} app template`);

  if (example) {
    const sha = await getExampleSHA(example);
    await gitCopySha(template, target, sha);
  } else {
    await gitCopy(template, target, branch);
  }

  process.chdir(target);

  spinner.text = 'Updating package.json...';
  await replace.replaceInFile({
    files: 'package.json',
    from: /"name": "saleor-app-template".*/g,
    to: `"name": "${packageName}",`,
  });

  await setupGitRepository(spinner);

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i', '--ignore-scripts'], { cwd: process.cwd() });
  await run('pnpm', ['generate'], { cwd: process.cwd() });

  spinner.succeed(
    chalk(
      'Your Saleor app is ready in the',
      chalk.yellow(target),
      'directory\n'
    )
  );

  console.log('  To start your application:\n');
  console.log(`    cd ${target}`);
  console.log('    pnpm dev');
};

const getFolderName = async (name: string): Promise<string> => {
  let folderName = name;
  while (await dirExists(folderName)) {
    folderName = folderName.concat('-0');
  }
  return folderName;
};

const dirExists = async (name: string): Promise<boolean> => {
  try {
    await access(name);
    return true;
  } catch (error) {
    return false;
  }
};

export const setupGitRepository = async (spinner: Ora) => {
  spinner.text = 'Setting up the Git repository...'; // eslint-disable-line no-param-reassign
  const git = simpleGit();
  await git.init(['--initial-branch', 'main']);
  await git.add('.');
  await git.commit('Initial commit from Saleor CLI');
};

const getExampleSHA = async (example: string) => {
  const examples = await getRepositoryContent();
  const filtered = examples.filter((e) => e.name === example);

  if (filtered.length === 0) {
    print(
      `The provided example app - ${example} - not found in the app-examples repository - https://github.com/saleor/app-examples`
    );

    process.exit(1);
  }

  const { sha } = filtered[0];

  return sha;
};

interface RepositoryContent {
  name: string;
  sha: string;
  path: string;
  git_url: string;
  url: string;
  html_url: string;
}

const getRepositoryContent = async (
  repoPath = 'https://api.github.com/repos/saleor/app-examples/contents/examples'
) => {
  const { github_token: GitHubToken } = await Config.get();

  const data: RepositoryContent[] = await got
    .get(repoPath, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: GitHubToken,
      },
    })
    .json();

  return data;
};

export const middlewares = [useToken];
