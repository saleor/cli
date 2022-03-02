import type { Arguments, CommandBuilder } from "yargs";
import enquirer from 'enquirer';
import got from "got";

import { Options } from "../types.js";
import { Config } from "../lib/config.js";
import { API, POST } from "../lib/index.js";

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { username } = await enquirer.prompt<{ username: string }>({
    type: "text", 
    name: 'username',
    message: 'Your Saleor Cloud email?'
  });
  const { password } = await enquirer.prompt<{ password: string }>({
    type: "password",
    name: 'password',
    message: 'Your password?'
  });

  const { statusCode, body }= await POST(API.Login, {}, { 
    json: { username, password }
  }) as { statusCode: number, body: { token: string } }

  if (statusCode === 200) {
    console.log("Success")
    const { token } = body
    Config.set("token", token)
  } else {
    console.log("Failed")
  }
};
