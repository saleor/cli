import _ from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";

export const command = "disable";
export const desc = "Disable the telemetry";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments) => {
  console.log(`${_.gray("Saleor Commerce CLI")} · Telemetry\n`);

  await Config.set("telemetry", "false");

  console.log(`${_.bold("Status:")} ${_.red("Disabled")}`);

  console.log(`
You have opted-out of our ${_.underline(
    "anonymous"
  )} telemetry program. We won't be collecting data from your machine.
Learn more: ${_.gray("https://saleor.io/")}${_.blueBright("telemetry")}
  `);
};
