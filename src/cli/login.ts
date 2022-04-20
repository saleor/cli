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
import { API, POST, amplifyConfig } from "../lib/index.js";

const { ux: cli } = CliUx;
const { GET } = route;
const { Redirect } = response;

const RedirectURI = "http://localhost:3000/";

const Params = {
  response_type: "code",
  client_id: amplifyConfig.aws_user_pools_web_client_id,
  redirect_uri: RedirectURI,
  identity_provider: "COGNITO",
  scope: amplifyConfig.oauth.scope.join(' ')
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
  const url = `https://${amplifyConfig.oauth.domain}/login?${QueryParams}`;
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
        client_id: amplifyConfig.aws_user_pools_web_client_id,
        redirect_uri: RedirectURI,
      }

      try {
        const { id_token }: any = await got.post(`https://${amplifyConfig.oauth.domain}/oauth2/token`, {
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

      return Redirect(amplifyConfig.oauth.redirectSignIn);
    })
  ])
  await app.start(3000);

  emitter.on('finish', async () => {
    await app.stop();
  });
};