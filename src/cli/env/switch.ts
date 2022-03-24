import chalk from "chalk";
import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { promptEnvironment } from "../../lib/util.js";

type Options = {
  key?: string;
};

export const command = "switch [key]";
export const desc = "Make the provided environmet the default one";

export const builder: CommandBuilder = (_) =>
  _.positional("key", {
    type: "string",
    demandOption: false,
    desc: 'key of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const environment = argv.key ? { name: argv.key, value: argv.key } :
                                    await promptEnvironment(argv);


  await Config.set("environment_id", environment.value);
  console.log(chalk.green("✔"), chalk.bold("Environment ·"), chalk.cyan(environment.value));
};
