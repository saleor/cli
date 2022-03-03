
import { interactiveDatabaseTemplate, interactiveEnvironment, interactiveProject, interactiveSaleorVersion } from "../../middleware/index.js";
import type { Arguments, CommandBuilder } from "yargs";
import { Options } from "../../types.js";

export const command = "setup [name]";
export const desc = "Setup a new project";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new backup'
  })

export const handler = async (argv: Arguments<Options>) => {
  process.exit(0);
};


export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
  interactiveEnvironment
]