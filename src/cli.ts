#!/usr/bin/env node --experimental-specifier-resolution=node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HTTPError, Response } from 'got';
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import organization from './cli/organization/index.js';
import environment from './cli/env/index.js';
import backup from './cli/backup/index.js';
import storefront from './cli/storefront/index.js';
import project from './cli/project/index.js';
import job from './cli/job/index.js';

import * as configure from './cli/configure.js';

yargs(hideBin(process.argv))
  .scriptName("saleor")
  .version()
  .alias('V', 'version')
  .usage('Usage: $0 <command> [options]')
  .command(configure)
  .command(['organization [command]', 'org'], '', organization)
  .command(['environment [command]', 'env'], '', environment)
  .command(['backup [command]'], '', backup)
  .command(['job [command]'], '', job)
  .command(['project [command]'], '', project)
  .command(['storefront [command]'], '', storefront)
  .strictCommands()
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .epilogue('for more information, find the documentation at https://saleor.io')
  .fail(function (msg, error, yargs) {
    if (error instanceof HTTPError) {
      const { body } = error.response as Response<any>;

      try {
        const errors = JSON.parse(body)
        console.error(emphasize.highlight("yaml", yaml.stringify({ errors }), {
          attr: chalk.red
        }).value);
      } catch (error: any) {
        console.log('Ouput is not JSON')
        console.log(error.message)
        console.error('---')
        console.error(body)
      }
    } else if (error) {
      console.log(error)
    } else {
      console.log(yargs.help())
    }
    process.exit(1)
  })
  .argv;