import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";
import { Options } from "../../types.js";

export const command = "clear <environment>";
export const desc = "Clear database for environment";

export const builder: CommandBuilder = (_) =>
  _.positional("key", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  console.log(`Clearing database: ${argv.environment}!`);

  const result = await GET(API.ClearDatabase, argv) as any;

  console.log(result.task_id)

  process.exit(0);
};
