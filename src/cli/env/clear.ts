import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";

interface Options {
  key: string
}

export const command = "clear <key>";
export const desc = "Clear database for environment";

export const builder: CommandBuilder = (_) =>
  _.positional("key", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;
  console.log(`Clearing database: ${key}!`);

  const result = await GET(API.ClearDatabase, { environment_id: key }) as any;

  console.log(result.task_id)

  process.exit(0);
};
