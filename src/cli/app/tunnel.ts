import { Arguments, CommandBuilder } from "yargs";
import { spawn } from "child_process";
import path from 'path';
import Enquirer from "enquirer";
import { doSaleorAppInstall, verifyIfSaleorAppRunning, verifyIsSaleorAppDirectory } from "../../lib/common.js";
import boxen from "boxen";
import chalk from "chalk";
import replace from "replace-in-file";
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import fetch from "node-fetch";
import { Config } from "../../lib/config.js";
import { useEnvironment, useOrganization, useToken } from "../../middleware/index.js";

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

interface Opts {
  name: string
  port: string
}

export const command = "tunnel [port]";
export const desc = "Expose your Saleor app remotely via tunnel";

export const builder: CommandBuilder = (_) =>
  _.positional("port", { type: "number", default: 3000 })
   .option('name', { type: 'string' })

export const handler = async (argv: Arguments<Opts>): Promise<void> => {
  // const spinner = ora('Starting your Saleor App...').start();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, '..', '..', '..', 'vendor');

  let appName;
  if (argv.name) {
    appName = argv.name;
  } else {
    const content = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8');
    appName = JSON.parse(content)['name'];
  }

  const { TunnelServerSecret } = await Config.get()

  console.log('\n Your Saleor App name:', chalk.yellow(appName));
  console.log('')

  const { organization, environment, port: localPort } = argv;

  const port = random(1025, 65535);

  const { install } = (await Enquirer.prompt({
    type: "confirm",
    name: "install",
    message: `Do you want to install this Saleor App in the ${environment} environment?`,
  })) as { install: boolean };

  const subdomain = `${appName}-${environment}-${organization}`.toLowerCase();
  const tunnelURL = `${subdomain}.saleor.live`;
  const winSuffix = process.platform === 'win32' ? '.cmd' : '';

  try {
    await fetch(`https://id.saleor.live/add/${subdomain}/${port}`, { method: 'POST' })

    const p = await spawn(
      `${vendorDir}/tunnel${winSuffix}`, [
      "local", localPort,
      "--to", tunnelURL,
      "--port", port.toString(),
      "--secret", TunnelServerSecret,
    ], { cwd: process.cwd() }
    );

    // spinner.succeed();

    console.log(
      boxen(`Your Saleor App URL is: ${chalk.blue(`https://${tunnelURL}`)}`, {
        padding: 1,
        margin: 1,
        float: "center",
        borderColor: "yellow",
      })
    );

    replace.sync({
      files: '.env',
      from: /APP_URL=.*/g,
      to: `APP_URL=https://${tunnelURL}`});

    if (install) {
      argv.manifestURL = `https://${tunnelURL}/api/manifest`;
      argv.appName = appName;

      await doSaleorAppInstall(argv);
    }
  } catch (error) {
    console.log('error')
    console.error(error);
  }
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  verifyIfSaleorAppRunning,
  useToken,
  useOrganization,
  useEnvironment,
]