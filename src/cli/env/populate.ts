import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";
import { Options } from "../../types.js";

export const command = "populate <environment>";
export const desc = "Populate database for environment";

export const builder: CommandBuilder = (_) =>
  _.positional("environment", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  const message = `Populating database: ${argv.environment}!`;
  console.log(message);

  const result = await GET(API.PopulateDatabase, argv) as any;

  console.log(result)

  process.exit(0);
};
