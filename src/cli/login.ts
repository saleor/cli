import crypto from 'crypto';
import EventEmitter from 'events';
import { CliUx } from '@oclif/core';
import chalk from 'chalk';
import Debug from 'debug';
import got from 'got';
import isEmpty from 'lodash.isempty';
import { nanoid } from 'nanoid';
import ora from 'ora';
import pkceChallenge from 'pkce-challenge';
import { ServerApp } from 'retes';
import { Response } from 'retes/response';
import { GET } from 'retes/route';
import invariant from 'tiny-invariant';
import { Arguments, CommandBuilder } from 'yargs';

import { Config, ConfigField, SaleorCLIPort } from '../lib/config.js';
import { checkPort } from '../lib/detectPort.js';
import {
  API,
  getEnvironment,
  POST,
  getCloudApiAuthDomain,
  defaultCloudApiUrl,
  defaultCloudApiAuthDomain,
} from '../lib/index.js';
import {
  CannotOpenURLError,
  delay,
  openURL,
  println,
  successPage,
} from '../lib/util.js';
import { Options } from '../types.js';

const environment = await getEnvironment();
const RedirectURI = `http://127.0.0.1:${SaleorCLIPort}/`;

const debug = Debug('saleor-cli:login');

export const command = 'login';
export const desc = 'Log in to the Saleor Cloud';

export const builder: CommandBuilder = (_) =>
  _.option('token', {
    type: 'string',
    demandOption: false,
    desc: 'use with headless flag, create a token at https://cloud.saleor.io/tokens',
  })
    .option('headless', {
      type: 'boolean',
      default: false,
      desc: 'login without the need for a browser',
    })
    .example('saleor login', '')
    .example('saleor login --headless', '')
    .example('saleor login --headless --token=TOKEN', '');

export const handler = async (argv: Arguments<any>) => {
  if (argv.headless) {
    const { ux: cli } = CliUx;
    let { token } = argv;
    while (!token)
      token = await cli.prompt(
        'Access Token - https://cloud.saleor.io/tokens',
        { type: 'mask' },
      );
    await doHeadlessLogin(token);
    return;
  }

  await doLogin();
};

export const doLogin = async () => {
  debug('check if port for the temporary HTTP server is free');
  await checkPort(SaleorCLIPort);

  const { code_challenge: codeChallenge, code_verifier: codeVerifier } =
    await pkceChallenge();

  const generatedState = nanoid();

  const BaseParams = {
    response_type: 'code',
    client_id: 'saleor-cli',
    redirect_uri: RedirectURI,
    scope: 'email openid profile',
    state: generatedState,
  };

  const KeycloakParams = {
    ...BaseParams,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };

  const emitter = new EventEmitter();

  const spinner = ora(
    'Logging in...Follow the instructions in your browser',
  ).start();
  debug(
    `prepare the Base OAuth params: ${JSON.stringify(BaseParams, null, 2)}`,
  );

  const cloudApiAuthDomain = await getCloudApiAuthDomain();

  const url = `https://${cloudApiAuthDomain}/realms/saleor-cloud/protocol/openid-connect/auth?${new URLSearchParams(
    {
      ...KeycloakParams,
    },
  )}`;

  try {
    debug(`opening browser with URL: ${url}`);
    await openURL(url);
  } catch (error) {
    invariant(error instanceof Error, 'Must be an error');

    spinner.fail(error.message);

    println(
      chalk('In a headless environment use', chalk.green('saleor configure')),
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
        code_verifier: codeVerifier,
        client_id: 'saleor-cli',
        redirect_uri: RedirectURI,
      };

      try {
        const tokenURL = `https://${cloudApiAuthDomain}/realms/saleor-cloud/protocol/openid-connect/token`;

        const response: any = await got
          .post(tokenURL, {
            form: OauthParams,
          })
          .json();

        const { id_token: idToken } = response;

        const secrets = await verifyToken(
          idToken,
          'https://id.saleor.online/verify',
        );

        const { token }: any = await POST(API.Token, {
          token: `Bearer ${idToken}`,
        } as Options);

        await createConfig(token, secrets);
      } catch (error) {
        if (error instanceof Error) {
          spinner.fail(error.message);
          emitter.emit('finish');

          return {
            body: successPage('Login failed!'),
            status: 200,
            type: 'text/html',
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
            },
          };
        }

        println(
          chalk(
            'In a headless environment use',
            chalk.green('saleor configure'),
          ),
        );
      }

      spinner.succeed(
        chalk.green('You\'ve successfully logged into Saleor Cloud!'),
      );
      println(
        'Your access token has been safely stored, and you\'re ready to go',
      );
      console.log('');
      emitter.emit('finish');

      return {
        body: successPage('You\'ve successfully logged into the Saleor CLI!'),
        status: 200,
        type: 'text/html',
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      };
    }),
  ]);
  await app.start(SaleorCLIPort);

  emitter.on('finish', async () => {
    await delay(1000);
    await app.stop();
  });
};

const doHeadlessLogin = async (token: string) => {
  try {
    const spinner = ora('\nLogging in...').start();
    const secrets = await verifyToken(
      token,
      'https://id.saleor.online/configure',
    );
    await createConfig(token, secrets);

    spinner.succeed(
      chalk.green('You\'ve successfully logged into Saleor Cloud!'),
    );
    println('Your access token has been safely stored, and you\'re ready to go');
  } catch (error) {
    throw new Error('The provided token couldn\'t be verified');
  }
};

const verifyToken = async (token: string, endpoint: string) => {
  debug('verify the token');
  const secrets: Record<ConfigField, string> = await got
    .post(endpoint, {
      json: {
        token,
        environment,
      },
    })
    .json();

  if (isEmpty(secrets)) {
    throw new Error('The provided token couldn\'t be verified');
  }

  return secrets;
};

const createConfig = async (
  token: string,
  secrets: Record<ConfigField, string>,
) => {
  const userSession = crypto.randomUUID();

  await Config.reset();
  await Config.set('token', `Token ${token}`);
  await Config.set('saleor_env', process.env.SALEOR_CLI_ENV || 'production');
  await Config.set(
    'cloud_api_url',
    process.env.SALEOR_CLI_ENV_URL || defaultCloudApiUrl,
  );
  await Config.set(
    'cloud_api_auth_domain',
    process.env.SALEOR_CLI_ENV_AUTH_DOMAIN || defaultCloudApiAuthDomain,
  );
  await Config.set('user_session', userSession);
  for (const [name, value] of Object.entries(secrets)) {
    await Config.set(name as ConfigField, value);
  }
};
