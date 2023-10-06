import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import { contentBox, formatDateTime, obfuscateArgv } from '../../lib/util.js';
import { Options, Tasks } from '../../types.js';

const parseJobName = (name: string) => {
  const [_, type, env, id] = /(\w{3})-(.+)-(\w{32})/g.exec(name) || [];

  return { type, env, id };
};

const debug = Debug('saleor-cli:task:list');

export const command = 'list';
export const desc = 'List tasks';

export const builder: CommandBuilder = (_) =>
  _.option('env', { type: 'string' })
    .option('page', {
      type: 'number',
      demandOption: false,
      desc: 'A page number within the paginated result set',
    })
    .option('page-size', {
      alias: 'page_size',
      type: 'number',
      demandOption: false,
      desc: 'Number of results to return per page',
    })
    .option('is-blocking', {
      alias: 'is_blocking',
      type: 'boolean',
      demandOption: false,
      desc: 'Filter by non/blocking tasks',
    })
    .option('status', {
      type: 'string',
      demandOption: false,
      desc: 'Filter by status: active, completed, failed, successful',
    })
    .example('saleor task list', '')
    .example('saleor task list my-environment --page=2', '')
    .example('saleor task list my-environment --page-size=100', '')
    .example('saleor task list my-environment --is-blocking', '')
    .example('saleor task list my-environment --status=active', '');

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));
  const _argv = argv;

  const params: string[] = [];

  ['page', 'page_size', 'is_blocking', 'status'].forEach((key: string) => {
    if (argv[key]) {
      params.push(`${key}=${argv[key]}`);
    }
  });

  if (params.length > 0) {
    _argv.params = `?${params.join('&')}`;
  }

  const result = (await GET(API.Task, _argv)) as Tasks;

  if (argv.json) {
    console.log(JSON.stringify(result.results, null, 2));
    return;
  }

  const {
    _: [name],
  } = argv;

  if (name === 'job') {
    contentBox(
      chalk(
        chalk.red('DEPRECATED'),
        'please use',
        chalk.green('saleor task list'),
        'command',
      ),
    );
  }

  const { ux: cli } = CliUx;

  cli.table(result.results, {
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
