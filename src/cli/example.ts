import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import kebabCase from 'lodash.kebabcase';
import ora from 'ora';
import path from 'path';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import type { Arguments, CommandBuilder } from 'yargs';

import { getFolderName, run } from '../lib/common.js';
import { gitCopy } from '../lib/download.js';
import { getRepositoryContent, setupGitRepository } from '../lib/git.js';
import {
  checkPnpmPresence,
  contentBox,
  obfuscateArgv,
  println,
} from '../lib/util.js';
import { useToken } from '../middleware/index.js';

const debug = Debug('saleor-cli:app:template');

export const command = 'example [name]';
export const desc = 'Setup an official Saleor example locally';

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
      alias: ['t', 'repo', 'repository'],
    })
    .example(
      'saleor example auth-sdk',
      'Setup the auth-sdk example from saleor/examples on GitHub',
    );

export const handler = async (argv: Arguments<any>): Promise<void> => {
  debug('command arguments: %O', obfuscateArgv(argv));

  debug('check PNPM presence');
  await checkPnpmPresence('This Saleor App template');

  const { name, template } = argv;

  let tmpl = template;

  if (!template) {
    const examples = await getRepositoryContent(
      'https://api.github.com/repos/saleor/examples/contents',
    );
    const choices = examples
      .map((e) => ({ name: e.name }))
      .filter((e) => e.name.startsWith('example-'))
      .map((e) => ({
        name: e.name.replace('example-', ''),
        message: e.name.replace('example-', ''),
      }));

    const { result } = await Enquirer.prompt<{ result: string }>({
      type: 'select',
      name: 'result',
      required: true,
      choices,
      message: 'Select an example',
    });

    tmpl = result;
  }

  debug('construct the folder name');
  const target = await getFolderName(sanitize(name));
  const packageName = kebabCase(target);
  const dirMsg = `Directory: ${chalk.blue(
    path.join(process.env.PWD || '.', target),
  )}`;
  const appMsg = `Name: ${chalk.blue(packageName)}`;
  const templateMsg = `Template: ${chalk.gray(
    'github.com/saleor/example-',
  )}${chalk.blue(chalk.underline(tmpl))}`;

  contentBox(`     ${templateMsg}\n         ${appMsg}\n    ${dirMsg}`);

  const spinner = ora('Downloading...').start();

  const repository = `https://github.com/saleor/example-${tmpl}.git`;
  debug(`downloading the example: ${repository}`);

  await gitCopy(repository, target);

  process.chdir(target);

  spinner.text = 'Updating package.json...';
  await replace.replaceInFile({
    files: 'package.json',
    from: /"name": "(.*)".*/g,
    to: `"name": "${packageName}",`,
  });

  spinner.text = 'Setting up the Git repository...';
  await setupGitRepository();

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i', '--ignore-scripts'], { cwd: process.cwd() });
  await run('pnpm', ['generate'], { cwd: process.cwd() });

  spinner.succeed(
    chalk(
      'Your Saleor example is ready in the',
      chalk.yellow(target),
      'directory\n',
    ),
  );

  println('  To start your application:\n');
  println(`    cd ${target}`);
  println('    pnpm dev');
};

export const middlewares = [useToken];
