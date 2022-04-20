import { CommandBuilder, Arguments } from "yargs";
import Enquirer from "enquirer";
import { validateEmail } from "../lib/util.js";
import chalk from "chalk";
import {Amplify, Auth} from "aws-amplify";
import { CliUx } from "@oclif/core";

const { ux: cli } = CliUx;

Amplify.configure({
  Auth: {
      region: "us-east-1",
      userPoolId: "us-east-1_FZpwvYl4o",
      userPoolWebClientId: "2recfkoclv4bf8dapibguvssem",
  }
});

interface Options  {
  fromCli?: boolean
}

export const command = "start";
export const desc = "Create Saleor account";

export const builder: CommandBuilder = (_) =>
  _.option("from-cli", {
    type: 'boolean',
    default: false,
    desc: 'specify sign up via CLI',
  })

export const handler = async (argv: Arguments<Options>) => {
  if (!argv.fromCli) {
    cli.open('https://cloud.saleor.io/register');
    process.exit(0);
  }

  if ("STAGING" in process.env) {
    console.log(chalk.red('This command can be run only on production!'));
    process.exit(1);
  }

  const json = await Enquirer.prompt<{email: string,
                                      firstName: string,
                                      lastName: string,
                                      password: string}>([
    {
      type: 'input',
      name: 'email',
      required: true,
      message: 'Email address',
      validate: (value) => validateEmail(value)
    },
    {
      type: 'input',
      name: 'firstName',
      required: true,
      message: 'First name'
    },
    {
      type: 'input',
      name: 'lastName',
      required: true,
      message: 'Last name'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
      required: true
    }
  ]);

  const confirms = await Enquirer.prompt<{confirm:string, terms: boolean}>([{
    type: 'password',
    name: 'confirm',
    message: 'Confirm password',
    validate: (value) => {
      if (value !== json.password) {
        return chalk.red(`Passwords must match`)
      }

      return true
    }},
    {
      type: 'confirm',
      name: 'terms',
      required: true,
      message: 'I agree to Saleor Terms and Conditions - https://saleor.io/legal/terms'
    }])

  if (!confirms.terms) return

  try {
    await Auth.signUp({
      username: json.email.toLowerCase(),
      password: json.password,
      attributes: {
          email: json.email.toLowerCase(),
          given_name: json.firstName,
          family_name: json.lastName
      }
    })
  } catch (err) {
    console.log(chalk.red((err as any)?.message))
    process.exit(1)
  }

  console.log('\nSaleor Cloud account created. \nWe\’ve sent you an email with verification code. Please provide it:\n')

  await Enquirer.prompt<{code: string}> ({
    type: 'input',
    name: 'code',
    message: 'Verfication code',
    required: true,
    validate: (value) => validateCode(json.email, value)
  })

  console.log('\nSaleor Cloud account confirmed. You can now sign in and create organization\n')
};

const validateCode = async (email: string, code: string): Promise<boolean> => {
  try {
    await Auth.confirmSignUp(email, code);
    return true
  } catch (err) {
    return false
  }
}