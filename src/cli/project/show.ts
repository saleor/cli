import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from "emphasize";
import chalk from "chalk";

import { API, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { interactiveProject } from "../../middleware/index.js";

export const command = "show [project]";
export const desc = "Show a specific project";

export const builder: CommandBuilder = (_) =>
  _.positional("project", { type: "string", demandOption: false });

export const handler = async (argv: Arguments<Options>) => {
  try {
    const result = (await GET(API.Project, argv)) as any;
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


export const middlewares = [
  interactiveProject
]