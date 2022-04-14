import type { CommandBuilder } from "yargs";
import ora from "ora";
import { CliUx } from "@oclif/core";
import { ServerApp, route } from "retes";
import { nanoid } from 'nanoid';

import { delay } from "../lib/util.js";
import got from "got";
import { Config } from "../lib/config.js";
import { response } from "retes";
import EventEmitter from 'events'
import { API, POST } from "../lib/index.js";

const { ux: cli } = CliUx;
const { GET } = route;
const { Redirect } = response;

const ClientID =  ("STAGING" in process.env) ?
  "2rb8kssv36nj9skfhdtm6uuevj" :
  "2recfkoclv4bf8dapibguvssem";

const RedirectURI = "http://localhost:3000/";

const BaseURL = ("STAGING" in process.env) ?
  "https://saleor-cloud-staging-oauth.auth.us-east-1.amazoncognito.com" :
  "https://auth.saleor.io";

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

export const handler = async () => {
  const generatedState = nanoid();
  const emitter = new EventEmitter();

  const spinner = ora('\nLogging in...').start();
  await delay(1500);
  spinner.text = '\nLogging in...\n';

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

      try {
        const { id_token }: any = await got.post(`${BaseURL}/oauth2/token`, {
          form: Params,
        }).json();
        const { token }: any  = await POST(
          API.Token,
          { token: `Bearer ${id_token}`}
        );

        await Config.reset();
        await Config.set("token", `Token ${token}`);
      } catch (error: any) {
        console.log(error);
      }

      spinner.succeed(`You've successfully logged into Saleor Cloud!\n  Your access token has been safely stored, and you're ready to go`)
      emitter.emit('finish');

      return Redirect('https://cloud.saleor.io');
    })
  ])
  await app.start(3000);

  emitter.on('finish', async () => {
    await app.stop();
  });
};