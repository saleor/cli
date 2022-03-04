import type { Arguments, CommandBuilder } from "yargs";
import enquirer from 'enquirer';
import ora from "ora";

import { Options } from "../types.js";
import { Config } from "../lib/config.js";
import { API, POST } from "../lib/index.js";
import { delay } from "../lib/util.js";

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { email } = await enquirer.prompt<{ email: string }>({
    type: "text", 
    name: 'email',
    message: 'Your Saleor Cloud email?'
  });
  const { password } = await enquirer.prompt<{ password: string }>({
    type: "password",
    name: 'password',
    message: 'Your password?'
  });

  const spinner = ora('\nLogging in...').start();
  await delay(1500);

  const { token } = await POST(API.Login, {}, { 
    json: { email, password }
  }) as { token: string }

  // error catch is centralized in `cli.ts`
  // below runs only if no error
  await Config.set("token", token)

  spinner.succeed('Success! Access granted and credentials savely stored')
};
