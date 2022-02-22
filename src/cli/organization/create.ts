import chalk from "chalk";
import { emphasize } from "emphasize";
import yaml from "yaml";
import {CliUx} from '@oclif/core'

import { API, POST } from "../../lib/index.js";

export const command = "create";
export const desc = "Create a new organization";

export const handler = async () => {
  console.log(`Creating organization`);

  const name = await CliUx.ux.prompt('What is the organization name? *')
  const company_name = await CliUx.ux.prompt('What is the company name?', { required: false })
  const email = await CliUx.ux.prompt('What is the organization name?', { required: false })
  const phone = await CliUx.ux.prompt('What is the organization phone?', { required: false })
  const address_1 = await CliUx.ux.prompt('What is the company address 1?', { required: false })
  const address_2 = await CliUx.ux.prompt('What is the company address 2?', { required: false })
  const city = await CliUx.ux.prompt('What is the company city?', { required: false })
  const country = await CliUx.ux.prompt('What is the company country?', { required: false })
  const postal_code = await CliUx.ux.prompt('What is the company postal_code?', { required: false })
  const region = await CliUx.ux.prompt('What is the company region?', { required: false })

  console.log(`You are going to crate organization ${name}`)
  const proceed = await CliUx.ux.confirm('Continue? Type yes/no')
  console.log(proceed)

  if (proceed) {
    const result = await POST(API.Organization, {
        organization_slug: "",
        json: {
          name,
          address_1,
          address_2,
          city,
          billing_email: '',
          company_name,
          country,
          email,
          phone,
          postal_code,
          region,
    
        }
      }) as any;
    
      console.log("---")
      console.log(emphasize.highlight("yaml", yaml.stringify(result), {
        'attr': chalk.blue
      }).value);      
  }

  process.exit(0);
};
