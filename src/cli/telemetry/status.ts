import type { Arguments, CommandBuilder } from "yargs";
import _ from "chalk";
import { Config } from "../../lib/config.js";

export const command = ["status", "$0"];
export const desc = "Show the telemetry status";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments) => {
  console.log(`${_.gray("Saleor Commerce CLI")} · Telemetry\n`);
  const { telemetry } = await Config.get();
  const isTelemetryEnabled = telemetry === undefined;

  const message = isTelemetryEnabled
    ? `${_.green("Enabled")}`
    : `${_.red("Disabled")}`;
  console.log(`Status: ${message}`);
};
