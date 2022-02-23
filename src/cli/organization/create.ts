import chalk from "chalk";
import { Arguments, CommandBuilder } from "yargs";

import { API, POST } from "../../lib/index.js";
import { Options } from "../../types.js";
import Enquirer from "enquirer";
import { Config } from "../../lib/config.js";

export const command = "create [name]";
export const desc = "Create a new organization";

export const builder: CommandBuilder = (_) =>
  _.positional("name", {
    type: "string",
    demandOption: false,
    desc: 'name for the new organization'
  })

export const handler = async (argv: Arguments<Options>) => {
  const { name } = argv;
  const form =  new (Enquirer as any).Form({
    name: 'Create a new organization',
    choices: [
      { name: "name", message: "What is the organization name? *", initial: name },
      { name: "company_name", message: "What is the company name?" },
      { name: "email", message: "What is the organization email?" },
      { name: "phone", message: "What is the organization phone?" },
      { name: "address_1", message: "What is the company address 1?" },
      { name: "address_2", message: "What is the company address 2?" },
      { name: "city", message: "What is the company city?" },
      { name: "country", message: "What is the company country?" },
      { name: "postal_code", message: "What is the company postal_code?" },
      { name: "region", message: "What is the company region?" }
    ]}
  )

  const json = await form.run()

  const { proceed } = await Enquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    message: `You are going to crate organization ${name}. Continue`,
  }) as { proceed: boolean };

  if (proceed) {
    const result = (await POST(
      API.Organization,
      { ...argv, organization: "" },
      {
        json
      }
    )) as any;

    console.log(chalk.green("✔"), chalk.bold("Organization has been successfuly created"));

    const message = chalk.green("Would you like to set the", chalk.bold(name), "as default ?");

    const { setDefault } = await Enquirer.prompt({
      type: 'confirm',
      name: 'setDefault',
      message,
    }) as { setDefault: boolean };

    if (setDefault) {
      await Config.set("organization_slug", result.slug);
      await Config.remove("environment_id");
    }

  }

  process.exit(0);
};