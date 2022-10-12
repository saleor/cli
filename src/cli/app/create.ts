import chalk from 'chalk';
import Debug from 'debug';
import { access } from 'fs/promises';
import GitUrlParse from 'git-url-parse';
import kebabCase from 'lodash.kebabcase';
import ora, { Ora } from 'ora';
import path from 'path';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import { simpleGit } from 'simple-git';
import { Arguments, CommandBuilder } from 'yargs';

import * as Config from '../../config.js';
import { run } from '../../lib/common.js';
import { downloadFromGitHub } from '../../lib/download.js';
import {
  checkPnpmPresence,
  contentBox,
  obfuscateArgv,
  println,
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
    .option('commit', {
      type: 'string',
      default: Config.SaleorAppHash,
      alias: 'c',
    })
    .option('template', {
      type: 'string',
      default: Config.SaleorAppRepo,
      alias: 't',
    });

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  debug('command arguments: %O', obfuscateArgv(argv));

  debug('check PNPM presence');
  await checkPnpmPresence('This Saleor App template');

  debug('construct the folder name');
  const target = await getFolderName(sanitize(argv.name));
  const packageName = kebabCase(target);
  const dirMsg = `App directory: ${chalk.blue(
    path.join(process.env.PWD || '.', target)
  )}`;
  const appMsg = ` Package name: ${chalk.blue(packageName)}`;

  contentBox(`    ${dirMsg}\n    ${appMsg}`);

  const spinner = ora('Downloading...').start();

  const { full_name: repo, resource } = GitUrlParse(argv.template);
  if (resource !== 'github.com') {
    throw new Error(`The provided host - ${resource} - is not yet supported`);
  }
  const commit = getCommit(argv, repo);

  debug(`downloading the app template: ${repo} - ${commit} - ${target}`);
  await downloadFromGitHub(repo, target, commit);

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

const getCommit = (argv: Arguments<StoreCreate>, repo: string) => {
  // saleor app template - use argv.commit
  if (repo === Config.SaleorAppRepo) {
    return argv.commit;
  }

  // custom template, default commit - use main
  if (argv.commit === Config.SaleorAppHash) {
    return 'main';
  }

  // custom template, custom commit
  return argv.commit;
};

export const setupGitRepository = async (spinner: Ora) => {
  spinner.text = 'Setting up the Git repository...'; // eslint-disable-line no-param-reassign
  const git = simpleGit();
  await git.init(['--initial-branch', 'main']);
  await git.add('.');
  await git.commit('Initial commit from Saleor CLI');
};

export const middlewares = [useToken];
