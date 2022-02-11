import { HTTPError, Response } from "got";
import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";

interface Options {
  key: string
}

export const command = "delete <key>";
export const desc = "Delete environmet";

export const builder: CommandBuilder = (_) =>
  _.positional("key", { 
    type: "string", 
    demandOption: false,
    desc: 'key of the environment'
  });

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;
  console.log(`Deleting environment: ${key}!`);

  const result = await DELETE(API.Environment(key)) as any;
  console.log(result)

  process.exit(0);
};
