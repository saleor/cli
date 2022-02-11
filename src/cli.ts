#!/usr/bin/env node --experimental-specifier-resolution=node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HTTPError, Response } from 'got';
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import env from './cli/env/index.js';
import * as configure from './cli/configure.js';

yargs(hideBin(process.argv))
  .scriptName("saleor")
  .version()
  .alias('V', 'version')
  .usage('Usage: $0 <command> [options]')
  .command(configure)
  .command(['organization [command]', 'org'], '', env)
  .command(['environment [command]', 'env'], '', env)
  .command(['backup [command]'], '')
  .command(['job [command]'], '')
  .command(['project [command]'], '')
  .strictCommands()
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .epilogue('for more information, find the documentation at https://saleor.io')
  .fail(function (msg, error, yargs) {
    if (error instanceof HTTPError) {
      const { body } = error.response as Response<any>;
      console.log(emphasize.highlight("yaml", yaml.stringify({ Errors: JSON.parse(body) }), {
        attr: chalk.red
      }).value);
    } else {
      console.error(error)
    }
    process.exit(1)
  })
  .argv;