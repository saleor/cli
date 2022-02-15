import type { Arguments, CommandBuilder } from "yargs";
import { cli } from "cli-ux";
import { HTTPError } from "got";
import inquirer from "inquirer";

import { API, GET } from "../lib/index.js";
import { Config } from "../lib/config.js";

type Options = {
  token?: string;
};

export const command = "configure [token]";
export const desc = "Configure Saleor CLI";

export const builder: CommandBuilder<{}, Options> = (_) =>
  _.positional("token", { type: "string", demandOption: false });


export const handler = async (argv: Arguments<Options>) => {
  let { token } = argv;
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
};

const validateToken = async (token: string) => {
  const user = (await GET(API.User, { token })) as any;
  console.log(`Logged as ${user.email}`);
};

const chooseOrganization = async (token: string) => {
  const orgs = (await GET(API.Organization, { token })) as any[];
  if (!orgs.length) return;

  const { organization_slug } = await inquirer.prompt([
    {
      type: "list",
      name: "organization_slug",
      message: "Choose organization:",
      choices: orgs.map((org) => ({name: org.name, value: org.slug})),
    },
  ]);

  return organization_slug;
};