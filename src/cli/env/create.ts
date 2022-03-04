import { Arguments, CommandBuilder } from "yargs";

import { interactiveDatabaseTemplate, interactiveProject, interactiveSaleorVersion } from "../../middleware/index.js";
import { createEnvironment } from "../../lib/util.js";

interface Options {
  name: string
  project: string
  saleor: string
  database: string
}

export const command = "create [name]";
export const desc = "Create a new environmet";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new environment'
  })
  .option("project", { 
    type: 'string',
    demandOption: false,
    desc: 'create this environment in this project',
  })
  .option("database", { 
    type: 'string',
    desc: 'specify how to populate the database',
  })
  .option("saleor", { 
    type: 'string',
    desc: 'specify the Saleor version',
  })

export const handler = async (argv: Arguments<Options>) => {
  await createEnvironment(argv);
};

export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
]