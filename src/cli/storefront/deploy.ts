import { cli } from "cli-ux";

import type { Arguments, CommandBuilder } from "yargs";

type Options = {
  name: string;
};


export const command = "deploy [name]";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { name } = argv;

  const params = {
    'repository-url': 'https://github.com/saleor/react-storefront',
    'project-name': name || 'my-react-storefront',
    'repository-name': name || 'my-react-storefront' 
  }

  const queryParams = new URLSearchParams(params)

  await cli.open(`https://vercel.com/new/clone?${queryParams}`)

  process.exit(0);
};
