import type { Arguments, CommandBuilder } from "yargs";

import { Config } from "../../lib/config.js";
import { promptEnvironment } from "../../lib/util.js";

type Options = {
  key: string;
};

export const command = "switch [key]";
export const desc = "Make the provided environmet the default one";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;
  console.log(key)

  const { token, organization_slug } = await Config.get()

  const environment_id = await promptEnvironment(token, organization_slug);
  await Config.set("environment_id", environment_id);

  process.exit(0);
};
