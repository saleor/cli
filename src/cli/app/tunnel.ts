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

interface Opts {
  name: string
  port: string
}

export const command = "tunnel <name>";
export const desc = "Expose your Saleor app remotely via tunnel";

export const builder: CommandBuilder = (_) => 
  _.positional("name", { type: "string", default: () => `my-saleor-app-${nanoid(5)}` })
   .positional("port", { type: "string", default: "3000" })

export const handler = async (argv: Arguments<Opts>): Promise<void> => {
  // const spinner = ora('Starting your Saleor App...').start();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const vendorDir = path.join(__dirname, '..', '..', '..', 'vendor');

  const { organization, environment, port: localPort } = argv;

  const port = random(1025, 65535);
  const appName = argv.name; 

  const { install } = (await Enquirer.prompt({
    type: "confirm",
    name: "install",
    message: `Do you want to install this Saleor App in the ${environment} environment?`,
  })) as { install: boolean };

  const subdomain = `${appName}.${environment}.${organization}`.toLowerCase();
  const tunnelURL = `${subdomain}.saleor.live`;

  try {
    await fetch(`https://id.saleor.live/add/${subdomain}/${port}`, { method: 'POST' })

    await spawn(
      `${vendorDir}/tunnel`, [
        "local", localPort,
        "--to", tunnelURL,
        "--port", port.toString(),
        "--secret", TunnelServerSecret,
      ], { cwd: process.cwd() }
    );

    // spinner.succeed();

    console.log(
      boxen(`Your Saleor App URL is: ${chalk.blue(`https://${tunnelURL}`)}\n${chalk.yellow('NOTE')} new domains may need few seconds to provision a SSL certificate`, {
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
