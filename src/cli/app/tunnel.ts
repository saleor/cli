import boxen from 'boxen';
import chalk from 'chalk';
import { spawn } from 'child_process';
import Debug from 'debug';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import ora from 'ora';
import path from 'path';
import { fileURLToPath } from 'url';
import { Arguments, CommandBuilder } from 'yargs';

import {
  doSaleorAppInstall,
  findSaleorAppByName,
  verifyIfSaleorAppRunning,
  verifyIsSaleorAppDirectory,
} from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { delay } from '../../lib/util.js';
import { useAppConfig, useInstanceConnector } from '../../middleware/index.js';
import { Options } from '../../types.js';

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

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
    .option('force-install', { type: 'boolean', default: false });

export const handler = async (argv: Arguments<Options>): Promise<void> => {
  debug('command arguments: %O', argv);

  debug(`Starting the tunnel with the port: ${argv.port}`);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, '..', 'vendor');

  debug('Extracting the Saleor app name');
  let appName: string;
  if (argv.name) {
    appName = argv.name;
  } else {
    const content = await fs.readFile(
      path.join(process.cwd(), 'package.json'),
      'utf-8'
    );
    appName = JSON.parse(content).name;
  }

  const { TunnelServerSecret } = await Config.get();

  const { organization, environment, port: localPort } = argv;

  const port = random(1025, 65535);
  debug(`Remote port: ${port}`);

  const baseURL = argv.instance!;

  const subdomain = `${appName}-${environment}-${organization}`.toLowerCase();
  const tunnelURL = `${subdomain}.saleor.live`;
  const winSuffix = process.platform === 'win32' ? '.cmd' : '';

  try {
    debug(`Linking the subdomain with a port: ${subdomain} <-> ${port}`);
    await fetch(`http://95.179.221.135:5544/add/${subdomain}/${port}`, {
      method: 'POST',
    });
    await delay(500);

    debug('Spawning the tunnel process');
    const p = spawn(
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

    const saleorAppName = `    Saleor App Name: ${chalk.yellow(appName)}`;
    const saleorAppURLMessage = `     Saleor App URL: ${chalk.blue(
      `https://${tunnelURL}`
    )}`;
    const dashboaardMsg = `   Saleor Dashboard: ${chalk.blue(
      `${baseURL}/dashboard/`
    )}`;
    const gqlMsg = ` GraphQL Playground: ${chalk.blue(`${baseURL}/graphql/`)}`;

    console.log(
      boxen(
        `${saleorAppName}\n${saleorAppURLMessage}\n\n${dashboaardMsg}\n${gqlMsg}`,
        {
          padding: 1,
          margin: 1,
          borderColor: 'yellow',
        }
      )
    );

    await delay(1000);

    const _argv = argv;
    _argv.manifestURL = `https://${tunnelURL}/api/manifest`;
    _argv.appName = appName;

    // Find the App ID
    debug('Searching for a Saleor app named:', appName);
    const app = await findSaleorAppByName(appName, _argv);
    debug('Saleor App found?', !app);

    if (!app || argv.forceInstall) {
      const spinner = ora('Installing... \n').start();

      // TODO this should return App ID, now it returns an ID of a job installing the app
      await doSaleorAppInstall(_argv);
      spinner.succeed();
    }

    console.log(
      `Tunnel is listening to your local machine on port: ${chalk.blue(
        localPort
      )}\n`
    );
    console.log('Press CTRL-C to stop the tunnel');
  } catch (error) {
    console.log('error');
    console.error(error);
  }
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  verifyIfSaleorAppRunning,
  useAppConfig,
  useInstanceConnector,
];
