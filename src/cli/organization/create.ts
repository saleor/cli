import chalk from "chalk";
import { Arguments, CommandBuilder } from "yargs";

import { API, POST } from "../../lib/index.js";
import { OrganizationCreate } from "../../types.js";
import Enquirer from "enquirer";
import { Config } from "../../lib/config.js";
import { countries, validateEmail, validateLength } from "../../lib/util.js";
import ora from "ora";

export const command = "create [name]";
export const desc = "Create a new organization";

export const builder: CommandBuilder = (_) =>
  _.positional("name", {
    type: "string",
    demandOption: false,
    desc: 'name for the new organization'
  })
  .option("company_name", {
    type: 'string',
    demandOption: false,
    desc: 'specify the company name',
  })
  .option("email", {
    type: 'string',
    desc: 'specify the company email',
  })
  .option("phone", {
    type: 'string',
    desc: 'specify the company phone',
  })
  .option("address_1", {
    type: 'string',
    desc: 'specify the company address_1',
  })
  .option("address_2", {
    type: 'string',
    desc: 'specify the company address_2',
  })
  .option("city", {
    type: 'string',
    desc: 'specify the company city',
  })
  .option("country", {
    type: 'string',
    desc: 'specify the company country - ISO 3166 Alpha-2',
  })
  .option("postal_code", {
    type: 'string',
    desc: 'specify the company postal code',
  })
  .option("region", {
    type: 'string',
    desc: 'specify the company region',
  })
  .option("default", {
    type: 'boolean',
    desc: 'set as default organization in CLI',
  })

export const handler = async (argv: Arguments<OrganizationCreate>) => {
  let json: OrganizationCreate = await Enquirer.prompt([{
    type: 'input',
    name: 'name',
    message: `What is the organization name? *`,
    initial: argv.name,
    skip: !!argv.name,
    validate: (value) =>  validateLength(value, 100, 'name', true)
  },{
    type: 'input',
    name: 'company_name',
    message: `What is the company name?`,
    initial: argv.company_name,
    skip: !!argv.company_name,
    validate: (value) => validateLength(value, 100, 'company_name')
  },{
    type: 'input',
    name: 'email',
    message: `What is the organization email?`,
    initial: argv.email,
    skip: !!argv.email,
    validate: (value) => validateEmail(value, false)
  },{
    type: 'input',
    name: 'phone',
    message: `What is the organization phone?`,
    initial: argv.phone,
    skip: !!argv.phone,
    validate: (value) => validateLength(value, 100, 'phome')
  },{
    type: 'input',
    name: 'address_1',
    message: `What is the company address 1?`,
    initial: argv.address_1,
    skip: !!argv.address_1,
    validate: (value) => validateLength(value, 256, 'address_1')
  },{
    type: 'input',
    name: 'address_2',
    message: `What is the company address 2?`,
    initial: argv.address_2,
    skip: !!argv.address_2,
    validate: (value) => validateLength(value, 256, 'address_2')
  },{
    type: 'input',
    name: 'city',
    message: `What is the company city?`,
    initial: argv.city,
    skip: !!argv.city,
    validate: (value) => validateLength(value, 256, 'city')
  },{
    type: 'autocomplete',
    name: 'country',
    message: "What is the company country?",
    initial: 0,
    skip: !!argv.country,
    choices: Object.keys(countries).map(c => ({
      name: c,
      message: countries[c]
    })),
  },{
    type: 'input',
    name: 'postal_code',
    message: `What is the company postal_code?`,
    initial: argv.postal_code,
    skip: !!argv.postal_code,
    validate: (value) => validateLength(value, 20, 'postal_code')
  },{
    type: 'input',
    name: 'region',
    message: `What is the company region?`,
    initial: argv.region,
    skip: !!argv.region,
    validate: (value) => validateLength(value, 128, 'region')
  }]);

  if (argv.country) {
    json = {...json, country: argv.country }
  }

  const spinner = ora(`Creating organization ${json.name}`).start();

  const result = (await POST(
    API.Organization,
    { ...argv, organization: "" },
    { json }
  )) as any;

  spinner.succeed('Yay! Organization created!')

  const { setDefault } = await Enquirer.prompt({
    type: 'confirm',
    name: 'setDefault',
    initial: argv.default,
    message: chalk.green("Would you like to set the", chalk.bold(json.name), "as default ?"),
  }) as { setDefault: boolean };

  if (setDefault) {
    await Config.set("organization_slug", result.slug);
    await Config.remove("environment_id");
  }
};