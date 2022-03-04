import type { Arguments, CommandBuilder } from "yargs";

import { CliUx } from "@oclif/core";
import _ from "chalk";
import Enquirer from "enquirer";

const { ux: cli } = CliUx;

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
    'repository-name': name || 'my-react-storefront',
    'env': 'NEXT_PUBLIC_API_URI,NEXT_PUBLIC_DEFAULT_CHANNEL',
    'envDescription': `'NEXT_PUBLIC_API_URI' is your GraphQL endpoint, while 'NEXT_PUBLIC_DEFAULT_CHANNEL' in most cases should be set to 'default-channel'`,
    'envLink': 'https://github.com/saleor/react-storefront',
  }

  const queryParams = new URLSearchParams(params)

  console.log(`You will be redirected to Vercel's deployment page to finish the process`); 
  console.log(`Use the following ${_.underline('Environment Variables')} for configuration:`);

  console.log(`
${_.gray('NEXT_PUBLIC_API_URI')}=https://vercel.saleor.cloud/graphql/
${_.gray('NEXT_PUBLIC_DEFAULT_CHANNEL')}=default-channel
  `)

  const { proceed } = (await Enquirer.prompt({
    type: "confirm",
    name: "proceed",
    message: `Do you want to continue?`,
  })) as { proceed: boolean };

  if (proceed) {
    await cli.open(`https://vercel.com/new/clone?${queryParams}`)
  }

  process.exit(0);
};
