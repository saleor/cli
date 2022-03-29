import type { Arguments, CommandBuilder } from "yargs";
import ora from "ora";
import { CliUx } from "@oclif/core";
import { ServerApp, route } from "retes";
import { nanoid } from 'nanoid';

import { delay } from "../../lib/util.js";
import { Options } from "../../types.js";
import got from "got";
import { Config } from "../../lib/config.js";

const { ux: cli } = CliUx;
const { GET } = route;

const ClientID = "5r1kk2fjnfdngoprj7ihlgihku";
const ClientSecret = "1fh39iiahp0u22b0p9cqt92cd4hs8acc1mat3gv7hacucobc0ff0";
const RedirectURI = "http://localhost:4000/";

const BaseURL = "https://saleor-cloud-staging-oauth.auth.us-east-1.amazoncognito.com";
const Params = {
  response_type: "code",
  client_id: ClientID,
  redirect_uri: RedirectURI,
  identity_provider: "COGNITO",
  scope: "phone email profile aws.cognito.signin.user.admin",
}

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const generatedState = nanoid();

  // const spinner = ora('\nLogging in...').start();
  // await delay(1500);

  const QueryParams = new URLSearchParams({...Params, state: generatedState });
  const url = `${BaseURL}/login?${QueryParams}`;
  cli.open(url);

  const app = new ServerApp([
    GET("/", async ({ params }) => {
      const { state, code } = params;

      if (state !== generatedState) {
        return "Wrong state"
      }

      const Params = {
        grant_type: "authorization_code",
        code,
        client_id: ClientID,
        redirect_uri: RedirectURI,
      }

      const auth = Buffer.from(`${ClientID}:${ClientSecret}`).toString('base64');

      try {
        const data: any = await got.post(`${BaseURL}/oauth2/token`, {
          form: Params,
          headers: {
            Authorization: `Basic ${auth}`
          }
        }).json();

        const { access_token, refresh_token } = data;

        await Config.set("token", `Bearer ${access_token}`);
        await Config.set("refresh_token", refresh_token);

      } catch (error: any) {
        console.log(error);
      }

      await app.stop(); 
      return "Check the CLI";
    })
  ])
  await app.start(4000);

  spinner.succeed('Success! Access granted and credentials savely stored')
};
