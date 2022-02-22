import chalk from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { chooseOrganization, chooseDefaultEnvironment } from "../../lib/util.js";

type Options = {
  key: string;
};

export const command = "switch [key]";
export const desc = "Make the provided organization the default one";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;

  const { token } = await Config.get()

  const organization_slug = await chooseOrganization(token);
//   TODO creation
  await Config.set("organization_slug", organization_slug);

  const environment_id = await chooseDefaultEnvironment(token, organization_slug);
//   TODO creation
  if (environment_id) {
    await Config.set("environment_id", environment_id);
  } else {
    //   create 
    console.log(chalk.green("Would you like to create an environment?"))
  }
  

  process.exit(0);
};
