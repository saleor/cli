import type { Arguments, CommandBuilder } from "yargs";
import { CliUx } from "@oclif/core";
import { HTTPError } from "got";

import { API, GET } from "../lib/index.js";
import { Config } from "../lib/config.js";
import { Options } from "../types.js";
import Enquirer from "enquirer";
import _ from "chalk";

const { ux: cli } = CliUx;

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false });

export const handler = async (argv: Arguments<Options>) => {
  let { token } = argv;
  await configure(token)

  const { telemetry } = await Enquirer.prompt({
    type: 'confirm',
    name: 'telemetry',
    initial: 'yes',
    message: 'Are you OK with leaving telemetry enabled?'
  }) as { telemetry: boolean }

  console.log(`
Saleor Telemetry is ${_.underline('completely anonymous and optional')} information about general usage. 
You may opt-out at any time (check 'saleor telemetry').
Learn more: ${_.gray('https://saleor.io/')}${_.blueBright('telemetry')}
  `)

  if (!telemetry) {
    Config.set('telemetry', 'false')
  }
};

const validateToken = async (token: string) => {
  const user = (await GET(API.User, { token })) as any;
  console.log(`${_.green('Success')}. Logged as ${user.email}\n`);
};

export const configure = async (token: string | undefined) => {
  while (!token) token = await cli.prompt("Access Token", { type: "mask" });

  try {
    await validateToken(token);
    Config.reset();
    await Config.set("token", token);
    return token
  } catch (error) {
    // FIXME make it more explicit
    if (error instanceof HTTPError) {
      console.log(error.message);
    } else {
      console.log(error);
    }
  }
}