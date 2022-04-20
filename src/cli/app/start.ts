import type { Arguments, CommandBuilder } from "yargs";
import ora from "ora";
import { spawn } from "child_process";
import { TunnelServerSecret } from "../../const.js";
import got from "got";
import Enquirer from "enquirer";
import { doSaleorAppInstall } from "../../lib/common.js";
import boxen from "boxen";
import chalk from "chalk";

const random = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1) + min);


export const command = "start";
export const desc = "Start and setup your Saleor App for development";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments): Promise<void> => {
  // const spinner = ora('Starting your Saleor App...').start();

  const { organization, environment } = argv;

  const port = random(1025, 65535);

  const name = `${environment}.${organization}`.toLowerCase();
  const tunnelURL = `${name}.saleor.live`;

  process.on("SIGINT", () => {
    console.log("Remove this vhost");
  });

  const { install } = (await Enquirer.prompt({
    type: "confirm",
    name: "install",
    message: `Do you want to install this Saleor App in the ${environment} environment?`,
  })) as { install: boolean };

  try {
    await fetch(`https://id.saleor.live/add/${name}/${port}`, { method: 'POST' })

    const child = await spawn(
      "bore", [
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
      argv.appName = `kubel`;

      await doSaleorAppInstall(argv);
    }
  } catch (error) {
    console.log('error')
    console.error(error);
  }
};
