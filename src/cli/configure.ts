import type { Arguments, CommandBuilder } from "yargs";
import { CliUx } from "@oclif/core";
import { HTTPError } from "got";

import { API, GET } from "../lib/index.js";
import { Config } from "../lib/config.js";
import { chooseDefaultEnvironment, chooseOrganization } from "../lib/util.js";

const { ux: cli } = CliUx;

type Options = {
  token?: string;
};

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false });

export const handler = async (argv: Arguments<Options>) => {
  let { token } = argv;
  await configure(token)
};

const validateToken = async (token: string) => {
  const user = (await GET(API.User, { token })) as any;
  console.log(`Logged as ${user.email}`);
};


export const configure = async (token: string | undefined) => {
  while (!token) token = await cli.prompt("Access Token", { type: "mask" });

  try {
    await validateToken(token);
    Config.reset();
    Config.set("token", token);

    const organization_slug = await chooseOrganization(token);
    Config.set("organization_slug", organization_slug);

    const environment_id = await chooseDefaultEnvironment(token, organization_slug);
    Config.set("environment_id", environment_id);
  } catch (error) {
    // FIXME make it more explicit
    if (error instanceof HTTPError) {
      console.log(error.message);
    } else {
      console.log(error);
    }
  }
}