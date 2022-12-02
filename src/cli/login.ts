import chalk from 'chalk';
import crypto from 'crypto';
import Debug from 'debug';
import EventEmitter from 'events';
import got from 'got';
import { nanoid } from 'nanoid';
import ora from 'ora';
import { ServerApp } from 'retes';
import { Response } from 'retes/response';
import { GET } from 'retes/route';
import invariant from 'tiny-invariant';

import { Config, ConfigField, SaleorCLIPort } from '../lib/config.js';
import { checkPort } from '../lib/detectPort.js';
import { API, getAmplifyConfig, getEnvironment, POST } from '../lib/index.js';
import { CannotOpenURLError, delay, openURL, println } from '../lib/util.js';

const RedirectURI = `http://localhost:${SaleorCLIPort}/`;

const debug = Debug('saleor-cli:login');

export const command = 'login';
export const desc = 'Log in to the Saleor Cloud';

export const handler = async () => {
  await doLogin();
};

export const doLogin = async () => {
  debug('check if port for the temporary HTTP server is free');
  await checkPort(SaleorCLIPort);

  debug('get AWS Amplify Configuration');
  const amplifyConfig = await getAmplifyConfig();

  const Params = {
    response_type: 'code',
    client_id: amplifyConfig.aws_user_pools_web_client_id,
    redirect_uri: RedirectURI,
    identity_provider: 'COGNITO',
    scope: amplifyConfig.oauth.scope.join(' '),
  };

  const generatedState = nanoid();
  const emitter = new EventEmitter();

  const spinner = ora('\nLogging in...').start();
  spinner.text = '\nLogging in...\nFollow the instructions in your browser';

  const QueryParams = new URLSearchParams({ ...Params, state: generatedState });
  debug(`prepare the OAuth params: ${JSON.stringify(QueryParams, null, 2)}`);

  const url = `https://${amplifyConfig.oauth.domain}/login?${QueryParams}`;

  try {
    await openURL(url);
  } catch (error) {
    invariant(error instanceof Error, 'Must be an error');

    spinner.fail(error.message);

    println(
      chalk('In a headless environment use', chalk.green('saleor configure'))
    );

    throw new CannotOpenURLError();
  }

  const app = new ServerApp([
    GET('/', async ({ params }) => {
      debug('getting request from the OAuth provider');
      const { state, code } = params;

      if (state !== generatedState) {
        return Response.BadRequest('Wrong state');
      }

      const OauthParams = {
        grant_type: 'authorization_code',
        code,
        client_id: amplifyConfig.aws_user_pools_web_client_id,
        redirect_uri: RedirectURI,
      };

      try {
        const { id_token: idToken, access_token: accessToken }: any = await got
          .post(`https://${amplifyConfig.oauth.domain}/oauth2/token`, {
            form: OauthParams,
          })
          .json();

        const { token }: any = await POST(API.Token, {
          token: `Bearer ${idToken}`,
        });

        const environment = await getEnvironment();
        const userSession = crypto.randomUUID();

        debug('verify the token');
        const secrets: Record<ConfigField, string> = await got
          .post('https://id.saleor.live/verify', {
            json: {
              token: accessToken,
              environment,
            },
          })
          .json();

        await Config.reset();
        await Config.set('token', `Token ${token}`);
        await Config.set('saleor_env', environment);
        await Config.set('user_session', userSession);
        for (const [name, value] of Object.entries(secrets)) {
          await Config.set(name as ConfigField, value);
        }
      } catch (error: any) {
        console.log(error);
      }

      spinner.succeed(
        chalk.green('You\'ve successfully logged into Saleor Cloud!')
      );
      console.log(
        'Your access token has been safely stored, and you\'re ready to go'
      );
      console.log('');
      emitter.emit('finish');

      return Response.Redirect(amplifyConfig.oauth.redirectSignIn);
    }),
  ]);
  await app.start(SaleorCLIPort);

  emitter.on('finish', async () => {
    await delay(1000);
    await app.stop();
  });
};
