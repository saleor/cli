/* eslint-disable no-async-promise-executor */
import { exec } from 'child_process';
import util from 'util';
import Debug from 'debug';
import fs from 'fs-extra';
import ora from 'ora';
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
  description: string;
}

export const command = 'docs';
export const desc = 'Generate docs';

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  const spinner = ora('Generating docs').start();

  const { stdout: helpOutput, stderr } = await execAsync(
    `${cliExecutable} --help`,
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

  debug('Generating files');
  await generateFiles(availableCommands as AvailableCommand[]);

  spinner.succeed();
};

/**
 * Following fns based on
 * https://github.com/EliseevNP/cli-docs-generator
 */

const getCommands = async (
  helpOutput: string,
  depth = 1,
  previousCommand = '',
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
              `${cliExecutable} ${cliCommand} --help`,
            );

            if (stderr) {
              reject(stderr);

              return;
            }

            const nestedCommands = await getCommands(
              stdout,
              depth + 1,
              cliCommand,
            );

            const description = stdout.split('\n\n')[1];

            resolve([
              {
                name: cliCommand,
                description,
                depth,
                helpOutput: stdout,
              } as AvailableCommand,
              nestedCommands as AvailableCommand[],
            ]);
          } catch (err) {
            console.log('err', err);
            reject(err);
          }
        }),
    ),
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
              }](#${cliCommand.name.split(' ').join('-')})`,
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

const generateFiles = async (availableCommands: AvailableCommand[]) => {
  const overviewContent = [
    overview.join('\n'),
    '',
    '## Available commands',
    availableCommands
      .map((cliCommand) => {
        const [rootCommand] = cliCommand.name.split(' ');

        return `${'  '.repeat(cliCommand.depth - 1)}* [${
          cliCommand.name
        }](./commands/${rootCommand}.mdx#${cliCommand.name
          .split(' ')
          .join('-')})`;
      })
      .join('\n'),
  ];

  await fs.writeFile('./docs/cli/overview.mdx', overviewContent.join('\n\n'));

  const rootCommands = availableCommands.reduce(
    (acc, c) => {
      if (!c.name) {
        return acc;
      }

      const commandHeader = [`# ${c.name}`, `## ${c.description}`];
      const content = [
        `###${'#'.repeat(c.depth - 1)} ${c.name}`,
        `\`\`\`sh\n$ ${executableName} ${c.name} --help\n\`\`\``,
        'Help output:',
        `\`\`\`\n${c.helpOutput}\`\`\``,
      ];

      // root command
      if (c.depth === 1) {
        acc[c.name] = [...commandHeader, ...content];
      }

      // subcommand
      if (c.depth > 1) {
        const [name] = c.name.split(' ');
        acc[name] = [...acc[name], ...content];
      }

      return acc;
    },
    {} as Record<string, string[]>,
  );

  Object.keys(rootCommands).forEach(async (key) => {
    await fs.writeFile(
      `./docs/cli/commands/${key}.mdx`,
      rootCommands[key].join('\n\n'),
    );
  });
};

const overview = [
  '---',
  'title: Overview',
  '---',
  '',
  'import Video from "@site/components/Video";',
  '',
  'Saleor provides a convenient command-line tool to speed the development around Saleor. Using our CLI you can interact with the Saleor platform using a terminal or through an automated system to quickly create and manage Saleor environments, test storefront installation and deploy to cloud providers such as Vercel or Netlify, and more.',
  '',
  '## Installing the CLI',
  '',
  'with `pnpm`',
  '',
  '```sh',
  'pnpm i @saleor/cli -g',
  '```',
  '',
  'or',
  '',
  'with `npm`',
  '',
  '```sh',
  'npm i @saleor/cli -g',
  '```',
  '',
  'From now on, you can interact with the Saleor CLI using the `saleor` name. If run with no parameters, it will show all available commands',
  '',
  '```',
  'saleor',
  '```',
  '',
  '## Quickstart',
  '',
  'Login with you Saleor Could account:',
  '',
  '```',
  'saleor login',
  '```',
  '',
  'The `saleor login` command allows you to establish the current user session in CLI. This will initiate an OAuth process. A browser window will open with the Saleor Cloud login page. Once authenticated, the CLI will receive an authentication token that will be stored locally for the CLI to access.',
  '',
  'If your environment doesn\'t support the browser use the `--headless` flag. The CLI will prompt for an Access Token skipping the need of browser operations. Create the Access Token at https://cloud.saleor.io/tokens.',
  '',
  'Video introduction to Saleor CLI',
  '',
  '<Video src="https://www.youtube.com/embed/b1TvC1UFk1w" />',
  '',
  '## Common options',
  '',
  'The following options can be used with all available commands',
  '',
  '### --help',
  '',
  'Show help',
  '',
  '**Alias:** `-h`',
  '',
  '```bash',
  'saleor environment --help',
  '```',
  '',
  '### --json',
  '',
  'Output the data as JSON',
  '',
  '```bash',
  'saleor environment list --json',
  '```',
  '',
  '### --short',
  '',
  'Output data as text',
  '',
  '```bash',
  'saleor environment --short',
  '```',
  '',
  '**Default:** `false`',
  '',
  '### --instance',
  '',
  'Saleor instance to work with',
  '',
  '**Alias:** `-u`, `--url`',
  '',
  '```bash',
  'saleor app install --instance="https://vercel.saleor.cloud"',
  '```',
  '',
  '### --version',
  '',
  'Show version number',
  '',
  '**Alias:** `-V`',
  '',
  '```bash',
  'saleor --version',
  '```',
];
