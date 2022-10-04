import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import { Arguments, CommandBuilder } from 'yargs';

import { obfuscateArgv } from '../lib/util';

const { ux: cli } = CliUx;

const debug = Debug('saleor-cli:register');

export const command = ['register', 'signup'];
export const desc = 'Create a Saleor Cloud account';

export const builder: CommandBuilder = (_) =>
  _.option('from-cli', {
    type: 'boolean',
    default: false,
    desc: 'specify sign up via CLI',
  });

export const handler = async (argv: Arguments) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const link = 'https://cloud.saleor.io/signup';

  console.log(
    `\nUse the following link:\n${chalk.blue(
      link
    )}\nto create a Saleor Cloud account.\n`
  );

  const { confirm } = await Enquirer.prompt<{ confirm: boolean }>([
    {
      type: 'confirm',
      name: 'confirm',
      required: true,
      format: (value) => chalk.cyan(value ? 'yes' : 'no'),
      message: 'Do you want to open it right now?',
    },
  ]);

  if (confirm) {
    cli.open(link);
  }

  process.exit(0);
};
