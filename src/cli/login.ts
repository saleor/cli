import type { CommandBuilder } from "yargs";
import { CliUx } from "@oclif/core";
import { ServerApp } from "retes";
import { GET } from "retes/route"
import { Redirect } from "retes/response";
import { nanoid } from 'nanoid';
import crypto from 'crypto';

import { delay } from "../lib/util.js";
import got from "got";
import { Config, ConfigField } from "../lib/config.js";
import EventEmitter from 'events'
import { API, POST, getAmplifyConfig, getEnvironment } from "../lib/index.js";
import { checkPort } from "../lib/detectPort.js";

const { ux: cli } = CliUx;

const RedirectURI = "http://localhost:3000/";

export const command = "login";
export const desc = "Log in to the Saleor Cloud";

export const builder: CommandBuilder = (_) => _

export const handler = async () => {
  await doLogin();
};

export const doLogin = async () => {
  await checkPort(3000);

  const amplifyConfig = await getAmplifyConfig();

  const Params = {
    response_type: "code",
    client_id: amplifyConfig.aws_user_pools_web_client_id,
    redirect_uri: RedirectURI,
    identity_provider: "COGNITO",
    scope: amplifyConfig.oauth.scope.join(' ')
  }

  const generatedState = nanoid();
  const emitter = new EventEmitter();

  // const spinner = ora('\nLogging in...').start();
  await delay(1500);
  // spinner.text = '\nLogging in...\n';

  const QueryParams = new URLSearchParams({ ...Params, state: generatedState });
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
        const { id_token, access_token }: any = await got.post(`https://${amplifyConfig.oauth.domain}/oauth2/token`, {
          form: Params,
        }).json();

        const { token }: any = await POST(API.Token, { token: `Bearer ${id_token}` });

        const environment = await getEnvironment();
        const user_session = crypto.randomUUID();

        const secrets: Record<ConfigField, string> = await got.post(`https://id.saleor.live/verify`, {
          json: {
            token: access_token,
            environment
          }
        }).json();

        await Config.reset();
        await Config.set("token", `Token ${token}`);
        await Config.set("user_session", user_session);
        for (const [name, value] of Object.entries(secrets)) {
          await Config.set(name as ConfigField, value);
        }
      } catch (error: any) {
        console.log(error);
      }

      // spinner.succeed(`You've successfully logged into Saleor Cloud!\n  Your access token has been safely stored, and you're ready to go`)
      emitter.emit('finish');

      return Redirect(amplifyConfig.oauth.redirectSignIn);
    })
  ])
  await app.start(3000);

  emitter.on('finish', async () => {
    await delay(1000);
    await app.stop();
  });
}