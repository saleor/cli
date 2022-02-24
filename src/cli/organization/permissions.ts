import chalk from 'chalk'
import { emphasize } from "emphasize";
import yaml from "yaml";
import type { Arguments, CommandBuilder } from "yargs";

import { API,  GET } from "../../lib/index.js";
import { useOrganization } from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "permissions";
export const desc = "List organization permissions";

export const builder: CommandBuilder = (_) =>
  _.positional("organization", { 
    type: "string", 
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const result = await GET(API.OrganizationPermissions, {...argv}) as any;

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};

export const middlewares = [
  useOrganization
]