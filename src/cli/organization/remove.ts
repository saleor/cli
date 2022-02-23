import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import {CliUx} from '@oclif/core'
import { Options } from "../../types.js";

export const command = "remove <organization>";
export const desc = "Remove the organization";

export const builder: CommandBuilder = (_) =>
  _.positional("slug", { 
    type: "string", 
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  console.log(`You are going to delete organization: ${argv.organization}!`);
  const proceed = await CliUx.ux.confirm('Continue? Type yes/no')

  if (proceed) {
    const result = await DELETE(API.Organization, argv) as any;
    console.log(result)
  }

  process.exit(0);
};