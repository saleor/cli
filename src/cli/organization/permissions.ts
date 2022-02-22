import type { Arguments, CommandBuilder } from "yargs";
import { API,  GET } from "../../lib/index.js";

interface Options {
  slug: string
}

export const command = "permissions <slug>";
export const desc = "List organization permissions";

export const builder: CommandBuilder = (_) =>
  _.positional("slug", { 
    type: "string", 
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const { slug } = argv;
  const result = await GET(API.OrganizationPermissions, { organization_slug: slug }) as any;

  console.log(result)

  process.exit(0);
};
