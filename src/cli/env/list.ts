import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { API, GET } from '../../lib/index.js';
import {
  formatDateTime,
  obfuscateArgv,
  verifyResultLength,
} from '../../lib/util.js';
import { EnvironmentList } from '../../types.js';

const debug = Debug('saleor-cli:env:list');

export const command = 'list';
export const desc = 'List environments';

export const builder: CommandBuilder = (_) =>
  _.option('extended', {
    type: 'boolean',
    default: false,
    desc: 'show extended table',
  });

export const handler = async (argv: Arguments<EnvironmentList>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { extended } = argv;
  const result = (await GET(API.Environment, {
    ...argv,
    environment: '',
  })) as any[];

  // const production = result.filter(({service}) => service.service_type === "SANDBOX")

  verifyResultLength(result, 'environment', argv.json);

  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { ux: cli } = CliUx;

  cli.table(
    result,
    {
      name: { minWidth: 2, get: ({ name }) => chalk.cyan(name) },
      created: {
        minWidth: 2,
        get: ({ created }) => chalk.gray(formatDateTime(created)),
      },
      project: { minWidth: 2, get: (_) => _.project.name },
      service: {
        minWidth: 2,
        header: 'Ver.',
        get: (_) => chalk.yellow(_.service.version),
      },
      key: { minWidth: 2 },
      domain: { minWidth: 2, get: ({ domain }) => domain, extended: true },
      service_type: { minWidth: 2, get: ({ service }) => service.service_type },
    },
    {
      extended: extended as boolean,
    },
  );

  process.exit(0);
};
