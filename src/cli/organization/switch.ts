import chalk from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { promptOrganization, promptEnvironment } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "switch [slug]";
export const desc = "Make the provided organization the default one";

export const builder: CommandBuilder = (_) =>
  _.positional("slug", {
    type: "string",
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const organization = argv.slug ? { name: argv.slug, value: argv.slug } :
                                    await promptOrganization(argv);

  await Config.set("organization_slug", organization.value);
  console.log(chalk.green("✔"), chalk.bold("Organization ·"), chalk.cyan(organization.value));
};
