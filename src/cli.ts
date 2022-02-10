#!/usr/bin/env node --experimental-specifier-resolution=node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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
  .argv;