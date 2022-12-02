/* eslint-disable no-async-promise-executor */
import { exec } from 'child_process';
import Debug from 'debug';
import fs from 'fs-extra';
import ora from 'ora';
import util from 'util';
import { CommandBuilder } from 'yargs';

const debug = Debug('saleor-cli:info');
const execAsync = util.promisify(exec);
const executableName = 'saleor';
const cliExecutable = 'node ./dist/saleor.js';
const output = './docs/README.md';

interface AvailableCommand {
  name: string;
  depth: number;
  helpOutput: string;
}

export const command = 'docs';
export const desc = 'Generate docs';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  const spinner = ora('Generating docs').start();

  const { stdout: helpOutput, stderr } = await execAsync(
    `${cliExecutable} --help`
  );
  if (stderr) {
    throw new Error(stderr);
  }
  const availableCommands = (await getCommands(helpOutput)).flat(Infinity);

  debug(`Found ${availableCommands.length} commands`);

  const content = [
    ...header,
    ...usage(helpOutput),
    ...commands(availableCommands as AvailableCommand[]),
  ];

  await fs.writeFile(output, content.join('\n\n'));
  spinner.succeed();
};

/**
 * Following fns based on
 * https://github.com/EliseevNP/cli-docs-generator
 */

const getCommands = async (
  helpOutput: string,
  depth = 1,
  previousCommand = ''
) => {
  const commandSection = helpOutput
    .split('\n\n')
    .find((section) => section.startsWith('Commands:'));

  const cliCommands = commandSection
    ? commandSection
        .split('\n')
        .slice(1)
        .map((commandString) => {
          const cliCommand = commandString
            .trim()
            .replace(`${executableName} ${previousCommand}`, '')
            .trim()
            .split(' ')[0];

          return previousCommand
            ? `${previousCommand} ${cliCommand}`
            : cliCommand;
        })
    : [];

  return Promise.all(
    cliCommands.map(
      (cliCommand) =>
        new Promise(async (resolve, reject) => {
          try {
            const { stdout, stderr } = await execAsync(
              `${cliExecutable} ${cliCommand} --help`
            );

            if (stderr) {
              reject(stderr);

              return;
            }

            const nestedCommands = await getCommands(
              stdout,
              depth + 1,
              cliCommand
            );

            resolve([
              {
                name: cliCommand,
                depth,
                helpOutput: stdout,
              } as AvailableCommand,
              nestedCommands as AvailableCommand[],
            ]);
          } catch (err) {
            console.log('err', err);
            reject(err);
          }
        })
    )
  );
};

const header = [
  '# Saleor CLI',
  '**Saleor CLI** is designed to boost your productivity and improve development experience with Saleor and Saleor Cloud. It will take the burden of spawning new storefronts and apps locally, managing and connecting them with Saleor instances, or establishing tunnels for local development in seconds.',
  '## Install',
  'with `pnpm`',
  '```sh\n$ pnpm i @saleor/cli -g\n```',
  'or',
  'with `npm`',
  '```sh\n$ npm i @saleor/cli -g\n```',
];

const usage = (helpOutput: string) => [
  '## Usage',
  `\`\`\`sh\n$ ${executableName} --help\n\`\`\``,
  'Help output:',
  `\`\`\`\n${helpOutput}\`\`\``,
];

const commands = (availableCommands: AvailableCommand[]) =>
  availableCommands.length
    ? [
        '---',
        '## Available commands',
        availableCommands
          .map(
            (cliCommand) =>
              `${'  '.repeat(cliCommand.depth - 1)}* [${
                cliCommand.name
              }](#${cliCommand.name.split(' ').join('-')})`
          )
          .join('\n'),
        ...availableCommands
          .map((c) => [
            `###${'#'.repeat(c.depth - 1)} ${c.name}`,
            `\`\`\`sh\n$ ${executableName} ${c.name} --help\n\`\`\``,
            'Help output:',
            `\`\`\`\n${c.helpOutput}\`\`\``,
          ])
          .reduce((cliCommands, cliCommand) => [...cliCommands, ...cliCommand]),
      ]
    : [];
