import type { Arguments, CommandBuilder } from "yargs";
import { deploy } from "../../lib/util.js"

type Options = {
  name: string;
};

export const command = "deploy [name]";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { name } = argv;
  await deploy(name);

  process.exit(0);
};
