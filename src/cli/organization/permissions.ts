import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";
import { Options } from "../../types.js";

export const command = "permissions <organization>";
export const desc = "List organization permissions";

export const builder: CommandBuilder = (_) =>
  _.positional("organization", { 
    type: "string", 
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const result = await GET(API.OrganizationPermissions, argv) as any;

  console.log(result)

  process.exit(0);
};
