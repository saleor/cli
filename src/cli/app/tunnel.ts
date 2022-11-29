import chalk from 'chalk';
import { exec, spawn } from 'child_process';
import Debug from 'debug';
import fs from 'fs-extra';
import { lookpath } from 'lookpath';
import fetch from 'node-fetch';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import util from 'util';
import { Arguments, CommandBuilder } from 'yargs';

import {
  doSaleorAppInstall,
  findSaleorAppByName,
  verifyIfSaleorAppRunning,
  verifyIsSaleorAppDirectory,
} from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import {
  contentBox,
  delay,
  NgrokError,
  obfuscateArgv,
} from '../../lib/util.js';
import {
  useAppConfig,
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

const execAsync = util.promisify(exec);

const debug = Debug('saleor-cli:app:tunnel');

export const command = 'tunnel [port]';
export const desc = 'Expose your Saleor app remotely via tunnel';

export const builder: CommandBuilder = (_) =>
  _.positional('port', { type: 'number', default: 3000 })
    .option('name', {
      type: 'string',
      demandOption: false,
      desc: 'The application name for installation in the Dashboard',
    })
    .option('force-install', { type: 'boolean', default: false })
    .option('use-ngrok', { type: 'boolean', default: false });

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { organization, environment, port: localPort, useNgrok } = argv;
  const baseURL = argv.instance!;

  debug(`Starting the tunnel with the port: ${argv.port}`);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, '..', 'vendor');

  debug('Extracting the Saleor app name');
  let appName: string;
  if (argv.name) {
    appName = argv.name;
  } else {
    const packagePath = path.join(process.cwd(), 'package.json');
    const content = await fs.readFile(packagePath, 'utf-8');
    appName = JSON.parse(content).name;
  }

  // ngrok tunnel

  let tunnelURL: string;

  if (useNgrok) {
    const isNgrokInstalled = await lookpath('ngrok');
    if (!isNgrokInstalled) throw new NgrokError('`ngrok` binary not found');

    const _p = spawn('ngrok', ['http', localPort || '3000'], {
      cwd: process.cwd(),
      stdio: 'ignore',
    });

    const { stdout } = await execAsync('ngrok api endpoints list');
    const {
      endpoints: {
        0: { public_url: publicURL },
      },
    } = JSON.parse(stdout);

    tunnelURL = publicURL;
  } else {
    // built-in tunnel

    const { TunnelServerSecret } = await Config.get();

    const port = random(1025, 65535);
    debug(`Remote port: ${port}`);

    const subdomain = `${appName}-${environment}-${organization}`.toLowerCase();
    tunnelURL = `https://${subdomain}.saleor.live`;

    const winSuffix = process.platform === 'win32' ? '.cmd' : '';

    try {
      debug(`Linking the subdomain with a port: ${subdomain} <-> ${port}`);
      await fetch(`http://95.179.221.135:5544/add/${subdomain}/${port}`, {
        method: 'POST',
      });
      await delay(500);

      debug('Spawning the tunnel process');
      const _p = spawn(
        `${vendorDir}/tunnel${winSuffix}`,
        [
          'local',
          localPort || '3000',
          '--to',
          tunnelURL,
          '--port',
          port.toString(),
          '--secret',
          TunnelServerSecret,
        ],
        { cwd: process.cwd(), stdio: 'ignore' }
      );
    } catch (error) {
      console.log('error');
      console.error(error);
    }
  }

  // General

  const saleorAppName = `    Saleor App Name: ${chalk.yellow(appName)}`;
  const saleorAppURLMessage = `     Saleor App URL: ${chalk.blue(tunnelURL)}`;
  const dashboardMsg = `   Saleor Dashboard: ${chalk.blue(
    `${baseURL}/dashboard/`
  )}`;
  const gqlMsg = ` GraphQL Playground: ${chalk.blue(`${baseURL}/graphql/`)}`;

  contentBox(
    `${saleorAppName}\n${saleorAppURLMessage}\n\n${dashboardMsg}\n${gqlMsg}`,
    { borderBottom: false }
  );

  await delay(1000);

  const _argv = argv;
  _argv.manifestURL = `${tunnelURL}/api/manifest`;
  _argv.appName = appName;

  // Find the App ID
  debug('Searching for a Saleor app named:', appName);
  let app = await findSaleorAppByName(appName, _argv);
  debug('Saleor App found?', !app);

  if (!app || argv.forceInstall) {
    const spinner = ora('Installing... \n').start();
    await doSaleorAppInstall(_argv);
    spinner.stop();

    app = await findSaleorAppByName(appName, _argv);
  }

  const appDashboardURL = `${baseURL}/dashboard/apps/${encodeURIComponent(
    app || ''
  )}/app`;
  contentBox(`Open app in Dashboard: ${chalk.blue(appDashboardURL)}`);

  console.log(
    `Tunnel is listening to your local machine on port: ${chalk.blue(
      localPort
    )}\n`
  );
  console.log('Press CTRL-C to stop the tunnel');
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  verifyIfSaleorAppRunning,
  useAppConfig,
  useInstanceConnector,
  useAvailabilityChecker,
];
