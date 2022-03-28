import type { Arguments, CommandBuilder } from "yargs";
import ora from "ora";
import { CliUx } from "@oclif/core";
import { ServerApp, route } from "retes";
import got from "got";

import { delay } from "../../lib/util.js";
import { Options } from "../../types.js";

const { ux: cli } = CliUx;
const { GET } = route;

const BaseURL = "https://www.oauth.com/playground/auth-dialog.html";
const Params = {
  response_type: "code",
  client_id: "MLPC6HEUMg03Kyx4JCsvyrqj",
  redirect_uri: "http://localhost:3001",
  // redirect_uri: "https://www.oauth.com/playground/authorization-code.html",
  scope: "photo offline_access",
  state: "2AH41e6pZmCQp1q0"
}

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const generatedState = 'alamakota123';

  const spinner = ora('\nLogging in...').start();
  await delay(1500);

  const QueryParams = new URLSearchParams({...Params, state: generatedState });
  cli.open(`${BaseURL}?${QueryParams}`);

  const app = new ServerApp([
    GET("/", ({ params }) => {
      const { state, code } = params;

      if (state !== generatedState) {
        return "Something went wrong"
      }

      // access_token
      const data = got.post('');

      return "";
    })
  ])
  await app.start(3001);


  spinner.succeed('Success! Access granted and credentials savely stored')
};
