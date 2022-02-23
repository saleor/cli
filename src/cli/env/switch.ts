import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { promptEnvironment } from "../../lib/util.js";

type Options = {
  environment: string;
};

export const command = "switch [environment]";
export const desc = "Make the provided environmet the default one";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const environment = await promptEnvironment(argv);
  await Config.set("environment_id", environment.value);

  process.exit(0);
};
