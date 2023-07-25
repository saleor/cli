#!/usr/bin/env node

import * as Sentry from '@sentry/node';
import chalk from 'chalk';
import Debug from 'debug';
import { emphasize } from 'emphasize';
import { HTTPError, Response, TimeoutError } from 'got';
import { createRequire } from 'module';
import semver from 'semver';
import yaml from 'yaml';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import app from './cli/app/index.js';
import backup from './cli/backup/index.js';
import checkout from './cli/checkout/index.js';
import * as configure from './cli/configure.js';
import dev from './cli/dev/index.js';
import environment from './cli/env/index.js';
import * as example from './cli/example.js';
import github from './cli/github/index.js';
import * as info from './cli/info.js';
import job from './cli/job/index.js';
import * as login from './cli/login.js';
import * as logout from './cli/logout.js';
import * as open from './cli/open.js';
import organization from './cli/organization/index.js';
import project from './cli/project/index.js';
import * as register from './cli/register.js';
import * as status from './cli/status.js';
import storefront from './cli/storefront/index.js';
import telemetry from './cli/telemetry/index.js';
import * as trigger from './cli/trigger.js';
import vercel from './cli/vercel/index.js';
import webhook from './cli/webhook/index.js';
import { Config } from './lib/config.js';
import { header } from './lib/images.js';
import { API, GET, getEnvironment } from './lib/index.js';
import {
  ChalkColor,
  ClientErrorCollection,
  contentBox,
  fetchLatestPackageVersion,
} from './lib/util.js';
import { useOnlineChecker, useTelemetry } from './middleware/index.js';
import { User } from './types.js';

const debug = Debug('saleor-cli');

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

if (!semver.satisfies(process.versions.node, '>= 16')) {
  console.error(
    `${chalk.red('ERROR')}: Saleor CLI requires Node.js 16.x or later`,
  );
  process.exit(1);
}

const ExecutionContext = {
  is(name: 'development' | 'staging' | 'production') {
    return (process.env.NODE_ENV ?? 'development') === name;
  },
  isNot(name: 'development' | 'staging' | 'production') {
    return !this.is(name);
  },
};

const {
  user_session: userSession,
  SentryDSN,
  lastUpdateCheck,
} = await Config.get();

if (
  pkg.version !== '0.0.0' &&
  ExecutionContext.is('production') && // check for updates only for `production`
  (!lastUpdateCheck ||
    Date.now() - new Date(lastUpdateCheck).valueOf() > 1000 * 60 * 60 * 24) // 1 day
) {
  debug(`checking for a new version of '${pkg.name}'...`);
  const latestVersion = await fetchLatestPackageVersion(pkg.name);
  await Config.set('lastUpdateCheck', new Date().toUTCString());

  if (semver.compare(latestVersion, pkg.version) > 0) {
    const updateCommand = `npm i -g ${pkg.name}`;
    const message = `  Update available ${chalk.dim(pkg.version)} ${chalk.reset(
      ' → ',
    )} ${chalk.green(latestVersion)}
  Run ${chalk.cyan(updateCommand)} to update`;

    console.log('');
    console.log(contentBox(message, { color: ChalkColor.Yellow }));
  }
}

const env = await getEnvironment();

if (ExecutionContext.isNot('development') && SentryDSN) {
  const release = `saleor-cli@${pkg.version}`;
  const dsn = SentryDSN;

  Sentry.init({
    dsn,
    environment: env,
    release,
  });
  Sentry.setUser({ id: userSession });
}

const parser = yargs(hideBin(process.argv))
  .scriptName('saleor')
  .version(pkg.version)
  .alias('V', 'version')
  .usage('Usage: $0 <command> [options]')
  .command(info)
  .command(status)
  .command(login)
  .command(logout)
  .command('configure', false, configure)
  .command(example)
  .command(register)
  .command(trigger)
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
  .command(['github [command]'], '', github)
  .command(['checkout [command]'], '', checkout)
  .command(['dev [command]'], false, dev)
  .command(open)
  .option('json', {
    type: 'boolean',
    default: false,
    desc: 'Output the data as JSON',
  })
  .option('short', {
    type: 'boolean',
    desc: 'Output data as text',
    default: false,
  })
  .option('instance', {
    alias: ['u', 'url'],
    type: 'string',
    desc: 'Saleor instance to work with',
  })
  .strictCommands()
  .middleware([useOnlineChecker, useTelemetry(pkg.version)])
  .demandCommand(1, 'You need at least one command before moving on')
  .alias('h', 'help')
  .wrap(null)
  .epilogue('for more information, find the documentation at https://saleor.io')
  .fail(async (msg, error, _yargs) => {
    if (
      error &&
      ExecutionContext.isNot('development') &&
      !ClientErrorCollection.includes(error.name)
    ) {
      Sentry.captureException(error);
    }

    if (error instanceof HTTPError) {
      const { body } = error.response as Response<any>;

      try {
        const errors = JSON.parse(body);
        console.error(
          emphasize.highlight('yaml', yaml.stringify({ errors }), {
            attr: chalk.red,
          }).value,
        );
      } catch (err: any) {
        console.log('Output is not JSON');
        console.log(err.message);
        console.error('---');
        console.error(body);
      }
    } else if (error instanceof TimeoutError) {
      // Don't display `Timeout` errors to user
    } else if (error) {
      console.error(`\n ${chalk.red('ERROR')} ${error.message}`);
      console.error('\n If you think this is a bug, report it on GitHub:');
      console.error(' https://github.com/saleor/saleor-cli/issues');
      console.error('\n CLI Docs:');
      console.error(' https://docs.saleor.io/docs/3.x/cli');
    } else {
      if (!process.argv.slice(2).length) {
        header(pkg.version);

        try {
          const config = await Config.get();
          const { token } = config;

          if (!token) throw new Error();

          const {
            first_name: firstName,
            last_name: lastName,
            email,
          } = (await GET(API.User, {
            token,
          })) as User;
          const user = [firstName, lastName].join(' ');

          console.log(chalk.blue(`\nLogged as ${user} ${email}\n`));
        } catch {
          console.log(chalk.red('\nYou are not logged in\n'));
        }
      }

      console.log(_yargs.help());
    }

    await Sentry.close(2000);

    process.exit(1);
  });

try {
  await parser.parse();
} catch (error) {
  // FIXME
  // https://github.com/yargs/yargs/blob/main/docs/advanced.md#handling-async-errors
}
