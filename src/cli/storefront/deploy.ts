import type { Arguments, CommandBuilder } from "yargs";
import { API, GET } from "../../lib/index.js";
import { deploy } from "../../lib/util.js"
import { Options } from "../../types.js";

export const command = "deploy [name]";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options & { name: string }>) => {
  const { name } = argv;
  const { domain } = await GET(API.Environment, argv) as any;

  const url = `https://${domain}/graphql/`;
  await deploy({ name, url });

  process.exit(0);
};
