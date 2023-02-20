import { ux as cli } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { formatDateTime, obfuscateArgv } from '../../lib/util.js';
import { Job, Options } from '../../types.js';

const parseJobName = (name: string) => {
  const [_, type, env, id] = /(\w{3})-(.+)-(\w{32})/g.exec(name) || [];

  return { type, env, id };
};

const debug = Debug('saleor-cli:job:list');

export const command = 'list';
export const desc = 'List jobs';

export const builder: CommandBuilder = (_) =>
  _.option('env', { type: 'string' });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const result = (await GET(API.Job, argv)) as Job[];

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  cli.table(result, {
    type: {
      header: 'Type',
      minWidth: 2,
      get: ({ job_name: jobName }) => {
        const { type } = parseJobName(jobName);

        switch (type) {
          case 'crt':
            return chalk.blue('CREATE');
          case 'bkp':
            return chalk.blue('BACKUP');
          case 'rst':
            return chalk.blue('RESTORE');
          default:
            return chalk.blue(type.toUpperCase());
        }
      },
    },
    env: {
      header: 'Environment',
      minWidth: 2,
      get: ({ job_name: jobName }) => parseJobName(jobName).env,
    },
    created_at: {
      minWidth: 2,
      get: ({ created_at: createdAt }) => chalk.gray(formatDateTime(createdAt)),
    },
    status: {
      minWidth: 2,
      get: ({ status }) => {
        switch (status) {
          case 'SUCCEEDED':
            return chalk.green(status);
          case 'PENDING':
            return chalk.yellow(status);
          default:
            return status;
        }
      },
    },
    job_name: {
      header: 'ID',
      minWidth: 2,
      get: ({ job_name: jobName }) => parseJobName(jobName).id,
    },
  });
};
