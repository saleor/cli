import type { Arguments, CommandBuilder } from "yargs";
import { CliUx } from "@oclif/core";
import { ServerApp, route } from "retes";
import { nanoid } from 'nanoid';

import { Options } from "../../types.js";
import got from "got";
import { Config } from "../../lib/config.js";
import { response } from "retes";
import EventEmitter from 'events'

const { ux: cli } = CliUx;
const { GET } = route;
const { Redirect } = response;

const ClientID = "***REMOVED***";
const ClientSecret = "***REMOVED***";
const RedirectURI = "http://localhost:3000/vercel/callback";

const BaseURL = "https://saleor-cloud-staging-oauth.auth.us-east-1.amazoncognito.com";
const Params = {
  response_type: "code",
  client_id: ClientID,
  redirect_uri: RedirectURI,
  identity_provider: "COGNITO",
  scope: "phone email openid profile aws.cognito.signin.user.admin",
}

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const generatedState = nanoid();
  const emitter = new EventEmitter();

  // const spinner = ora('\nLogging in...').start();
  // await delay(1500);
  // spinner.text = '\nLogging in...\n';

  const QueryParams = new URLSearchParams({ state: generatedState });
  const url = `https://vercel.com/integrations/saleor/new?${QueryParams}`;
  cli.open(url);

  const app = new ServerApp([
    GET("/vercel/callback", async ({ params }) => {
      const { state, code } = params;

      if (state !== generatedState) {
        return "Wrong state"
      }

      const Params = {
        client_id: ClientID,
        client_secret: ClientSecret,
        code,
        redirect_uri: RedirectURI,
      }

      try {
        const data: any = await got.post(`https://api.vercel.com/v2/oauth/access_token`, {
          form: Params,
        }).json();

        const { access_token, team_id } = data;

        await Config.set("vercel_token", `Bearer ${access_token}`);
        await Config.set("vercel_team_id", team_id);

      } catch (error: any) {
        console.log(error.message);
      }

      // spinner.succeed(`You've successfully logged into Saleor Cloud!\n  Your access token has been safely stored, and you're ready to go`)
      emitter.emit('finish');

      return Redirect('https://cloud.saleor.io');
    })
  ])
  await app.start(3000);

  emitter.on('finish', async () => {
    await app.stop();
  });
};
