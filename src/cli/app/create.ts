import boxen from 'boxen';
import chalk from 'chalk';
import Debug from 'debug';
import { access } from 'fs/promises';
import kebabCase from 'lodash.kebabcase';
import ora, { Ora } from 'ora';
import path from 'path';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import { simpleGit } from 'simple-git';
import { Arguments, CommandBuilder } from 'yargs';

import { run } from '../../lib/common.js';
import { downloadFromGitHub } from '../../lib/download.js';
import { checkPnpmPresence } from '../../lib/util.js';
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
  }).option('dependencies', {
    type: 'boolean',
    default: true,
    alias: 'deps',
  });

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  debug('command arguments: %O', argv);

  debug('check PNPM presence');
  await checkPnpmPresence('This Saleor App template');

  debug('construct the folder name');
  const target = await getFolderName(sanitize(argv.name));
  const packageName = kebabCase(target);
  const dirMsg = `App directory: ${chalk.blue(
    path.join(process.env.PWD || '.', target)
  )}`;
  const appMsg = ` Package name: ${chalk.blue(packageName)}`;
  console.log(
    boxen(`${dirMsg}\n${appMsg}`, {
      padding: 1,
      margin: 1,
      borderColor: 'yellow',
    })
  );

  const spinner = ora('Downloading...').start();
  debug('downloading the `master` app template');
  await downloadFromGitHub(
    'saleor/saleor-app-template',
    target,
    '659ed312a4930e38150276e0ea714efc6ccc22e3'
  );

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

export const middlewares = [useToken];
