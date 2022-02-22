import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from "emphasize";
import chalk from "chalk";

import { API, GET } from "../../lib/index.js";

type Options = {
  key: string;
};

export const command = "show [key]";
export const desc = "Show a specific backup";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;

  try {
    const result = (await GET(API.Backup, { backup_id: key })) as any;
    console.log("---");
    console.log(
      emphasize.highlight("yaml", yaml.stringify(result), {
        attr: chalk.blue,
      }).value
    );

    process.exit(0);
  } catch (error: any) {
    console.log(error.message);
  }
};
