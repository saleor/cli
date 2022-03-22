import enquirer from "enquirer";
import ora from "ora";
import type { Arguments, CommandBuilder } from "yargs";
import { API, GET, POST } from "../../lib/index.js";
import { delay, deploy } from "../../lib/util.js"
import { Options } from "../../types.js";

export const command = "deploy [name]";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options & { name: string }>) => {
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

  const spinner = ora('\nCreating access token...').start();
  await delay(1500);

  const { token } = await POST(API.Login, {}, { 
    json: { email, password }
  }) as { token: string }

  spinner.succeed("Success! Here's your token: ");
  console.log(token)
};
