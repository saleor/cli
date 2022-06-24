import _ from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";

export const command = "enable";
export const desc = "Enable the telemetry";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments) => {
  console.log(`${_.gray("Saleor Commerce CLI")} · Telemetry\n`);

  Config.remove("telemetry");

  console.log(`Status: ${_.green("Enabled")}`);

  console.log(`
Saleor Telemetry is ${_.underline("anonymous")}. Thank you for participating!
Learn more: ${_.gray("https://saleor.io/")}${_.blueBright("telemetry")}
  `);
};
