import { CliUx } from "@oclif/core";
import chalk from "chalk";
import figlet from "figlet";
import { createRequire } from "module";
import type { CommandBuilder } from "yargs";

import { header } from "../lib/images.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json");

const { ux: cli } = CliUx;
export const command = "info";
export const desc = "Hello from Saleor";

export const builder: CommandBuilder = (_) => _;
export const handler = async (): Promise<void> => {
  header(pkg.version);

  console.log(`


   `);
  console.log(
    chalk.blue(
      figlet.textSync("             saleor", {
        font: "Standard",
        horizontalLayout: "default",
        width: 120,
        verticalLayout: "default",
        whitespaceBreak: true,
      })
    )
  );

  console.log(
    chalk.bold.blueBright(`
                     The commerce API that puts developers first
   `)
  );

  cli.url(chalk.blue("Website - https://saleor.io/"), "https://saleor.io/");
  cli.url(
    chalk.blue("Console - https://cloud.saleor.io/"),
    "https://cloud.saleor.io/"
  );
  cli.url(
    chalk.blue("Github  - https://github.com/saleor/"),
    "https://github.com/saleor/"
  );
};
