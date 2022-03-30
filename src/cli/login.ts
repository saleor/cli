import type { Arguments, CommandBuilder } from "yargs";
import enquirer from 'enquirer';
import ora from "ora";
import { Amplify, Auth } from 'aws-amplify';

import { Options } from "../types.js";
import { Config } from "../lib/config.js";
import { API, POST } from "../lib/index.js";
import { delay } from "../lib/util.js";

Amplify.configure({
  Auth: {
    region: "us-east-1",
    userPoolId: "us-east-1_GBDllN7JY",
    userPoolWebClientId: "2rb8kssv36nj9skfhdtm6uuevj",
  }
});

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

  const r = await Auth.signIn(email, password);
  // FIXME why `idToken` and not `accessToken` ??
  const { signInUserSession: { idToken: { jwtToken: token } } } = r;

  // error catch is centralized in `cli.ts`
  // below runs only if no error
  await Config.set("token", `Bearer ${token}`)
  spinner.succeed('Success! Access granted and credentials savely stored')
};
