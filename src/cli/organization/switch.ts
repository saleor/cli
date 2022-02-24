import chalk from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { promptOrganization, promptEnvironment } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "switch";
export const desc = "Make the provided organization the default one";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const organization_slug = await promptOrganization(argv);
  //   TODO creation
  await Config.set("organization_slug", organization_slug.value);

  const environment_id = await promptEnvironment({
    ...argv,
    organization: organization_slug.value,
  });
  //   TODO creation
  if (environment_id) {
    await Config.set("environment_id", environment_id.value);
  } else {
    //   create
    console.log(chalk.green("Would you like to create an environment?"));
  }

  process.exit(0);
};
