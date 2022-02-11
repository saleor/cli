import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";

interface Options {
  key: string
}

export const command = "populate <key>";
export const desc = "Populate database for environment";

export const builder: CommandBuilder = (_) =>
  _.positional("key", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;
  const message = `Populating database: ${key}!`;
  console.log(message);

  const result = await GET(API.PopulateDatabase(key)) as any;

  console.log(result)

  process.exit(0);
};
