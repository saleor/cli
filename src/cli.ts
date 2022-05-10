#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { HTTPError, Response } from 'got';
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';
import { createRequire } from "module";
import updateNotifier from 'update-notifier';

import organization from './cli/organization/index.js';
import environment from './cli/env/index.js';
import backup from './cli/backup/index.js';
import storefront from './cli/storefront/index.js';
import project from './cli/project/index.js';
import job from './cli/job/index.js';
import telemetry from './cli/telemetry/index.js';
import webhook from './cli/webhook/index.js';
import app from './cli/app/index.js';
import vercel from './cli/vercel/index.js';

import * as login from './cli/login.js';
import * as logout from './cli/logout.js';
import * as configure from './cli/configure.js';
import * as info from './cli/info.js';
import * as register from './cli/register.js';
import { header } from './lib/images.js';
import { useTelemetry } from './middleware/index.js';
import { AuthError, NotSaleorAppDirectoryError } from './lib/util.js';

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

// console.log(boxen('Update available\nsomething', { padding: 1, margin: 1, float: 'center', borderColor: 'yellow' }));

const notifier = updateNotifier({
  pkg,
  updateCheckInterval: 1000 * 60 * 15 // 15 minutes
});
notifier.notify({isGlobal: true});

yargs(hideBin(process.argv))
  .scriptName("saleor")
  .version(pkg.version)
  .alias('V', 'version')
  .usage('Usage: $0 <command> [options]')
  .command(info)
  .command(login)
  .command(logout)
  .command(configure)
  .command(register)
  .command(['organization [command]', 'org'], '', organization)
  .command(['environment [command]', 'env'], '', environment)
  .command(['backup [command]'], '', backup)
  .command(['job [command]'], '', job)
  .command(['project [command]'], '', project)
  .command(['storefront [command]', 'store'], '', storefront)
  .command(['telemetry [command]', 'tele'], '', telemetry)
  .command(['webhook [command]', 'hook'], '', webhook)
  .command(['app [command]'], '', app)
  .command(['vercel [command]'], '', vercel)
  .strictCommands()
  .middleware(useTelemetry(pkg.version))
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .epilogue('for more information, find the documentation at https://saleor.io')
  .fail(async (msg, error, yargs) => {
    if (error instanceof HTTPError) {
      const { body } = error.response as Response<any>;

      try {
        const errors = JSON.parse(body)
        console.error(emphasize.highlight("yaml", yaml.stringify({ errors }), {
          attr: chalk.red
        }).value);
      } catch (error: any) {
        console.log('Output is not JSON')
        console.log(error.message)
        console.error('---')
        console.error(body)
      }
    } else if (error instanceof AuthError) {
      console.log(`\n ${chalk.red('ERROR')} ${error.message}`);
    } else if (error instanceof NotSaleorAppDirectoryError) {
      console.log(`\n ${chalk.red('ERROR')} ${error.message}`);
    } else if (error) {
      console.log(error)
    } else {
      if (!process.argv.slice(2).length) header(pkg.version);
      console.log(yargs.help())
    }
    process.exit(1)
  })
  .argv;