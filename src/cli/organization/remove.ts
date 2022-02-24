import type { Arguments, CommandBuilder } from "yargs";
import { API, DELETE } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptOrganization } from "../../lib/util.js";
import Enquirer from "enquirer";
import { Config } from "../../lib/config.js";
import chalk from "chalk";

export const command = "remove";
export const desc = "Remove the organization";

export const builder: CommandBuilder = (_) =>
  _.positional("slug", { 
    type: "string", 
    demandOption: false,
    desc: 'slug of the organization'
  });

export const handler = async (argv: Arguments<Options>) => {
  const organization = await promptOrganization(argv)

  console.log(`You are going to delete organization: ${organization.name}!`);

  const { proceed } = await Enquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    message: `You are going to remove organization ${organization.name}. Continue`,
  }) as { proceed: boolean };

  if (proceed) {
    await DELETE(API.Organization, {...argv, organization: organization.value}) as any;
    const { organization_slug } = await Config.get();
    if (organization.value === organization_slug) {
      Config.remove("organization_slug")
    }

    console.log(chalk.green("✔"), chalk.bold("Organization has been successfuly removed"));
  }

  process.exit(0);
};