import type { Arguments, CommandBuilder } from "yargs";
import { spawn } from "child_process";
import path from 'path';
import { TunnelServerSecret } from "../../const.js";
import Enquirer from "enquirer";
import { doSaleorAppInstall } from "../../lib/common.js";
import boxen from "boxen";
import chalk from "chalk";
import { fileURLToPath } from 'url';
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet('1234567890abcdefghijklmnoprstuwxyz', 5)

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);

export const command = "start";
export const desc = "Start and setup your Saleor App for development";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments): Promise<void> => {
  // const spinner = ora('Starting your Saleor App...').start();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, '..', '..', '..', 'vendor');

  const { organization, environment } = argv;

  const port = random(1025, 65535);

  const name = `${environment}.${organization}`.toLowerCase();
  const tunnelURL = `${name}.saleor.live`;

  let appName = `my-saleor-app-${nanoid(5)}`

  const { install } = (await Enquirer.prompt({
    type: "confirm",
    name: "install",
    message: `Do you want to install this Saleor App in the ${environment} environment?`,
  })) as { install: boolean };

  // place here, because it must be run before the tunnel
  if (install) {
    const { name } = (await Enquirer.prompt({
      type: "input",
      name: "name",
      initial: appName,
      message: `How should your Saleor App be named?`,
    })) as { name: string };

    appName = name 
  }

  try {
    await fetch(`https://id.saleor.live/add/${name}/${port}`, { method: 'POST' })

    await spawn(
      `${vendorDir}/tunnel`, [
        "local", "3000",
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
