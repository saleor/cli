import chalk from "chalk";
import { emphasize } from "emphasize";
import yaml from "yaml";
import { CliUx } from "@oclif/core";

import { API, POST } from "../../lib/index.js";
import { Options } from "../../types.js";
import { Arguments } from "yargs";
import Enquirer from "enquirer";
import { Config } from "../../lib/config.js";

export const command = "create";
export const desc = "Create a new organization";

export const handler = async (argv: Arguments<Options>) => {
  console.log(`Creating organization`);

  const name = await CliUx.ux.prompt("What is the organization name? *");
  const company_name = await CliUx.ux.prompt("What is the company name?", {
    required: false,
  });
  const email = await CliUx.ux.prompt("What is the organization name?", {
    required: false,
  });
  const phone = await CliUx.ux.prompt("What is the organization phone?", {
    required: false,
  });
  const address_1 = await CliUx.ux.prompt("What is the company address 1?", {
    required: false,
  });
  const address_2 = await CliUx.ux.prompt("What is the company address 2?", {
    required: false,
  });
  const city = await CliUx.ux.prompt("What is the company city?", {
    required: false,
  });
  const country = await CliUx.ux.prompt("What is the company country?", {
    required: false,
  });
  const postal_code = await CliUx.ux.prompt(
    "What is the company postal_code?",
    { required: false }
  );
  const region = await CliUx.ux.prompt("What is the company region?", {
    required: false,
  });

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
        json: {
          name,
          address_1,
          address_2,
          city,
          billing_email: "",
          company_name,
          country,
          email,
          phone,
          postal_code,
          region,
        },
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
