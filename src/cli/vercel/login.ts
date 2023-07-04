import chalk from 'chalk';
import Debug from 'debug';
import EventEmitter from 'events';
import got from 'got';
import { nanoid } from 'nanoid';
import { ServerApp } from 'retes';
import { Response } from 'retes/response';
import { GET } from 'retes/route';

import { Config, SaleorCLIPort } from '../../lib/config.js';
import { checkPort } from '../../lib/detectPort.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';
import { delay, openURL, printlnSuccess, successPage } from '../../lib/util.js';

const RedirectURI = `http://localhost:${SaleorCLIPort}/vercel/callback`;

const debug = Debug('saleor-cli:vercel:login');

export const command = 'login';
export const desc = 'Add integration for Saleor CLI';

export const builder = NoCommandBuilderSetup;

export const handler = async () => {
  await checkPort(SaleorCLIPort);

  const generatedState = nanoid();
  const emitter = new EventEmitter();

  const { VercelClientID, VercelClientSecret } = await Config.get();

  // const spinner = ora('\nLogging in...').start();
  // await delay(1500);
  // spinner.text = '\nLogging in...\n';

  const QueryParams = new URLSearchParams({ state: generatedState });
  const url = `https://vercel.com/integrations/saleor-cli/new?${QueryParams}`;
  await openURL(url);

  const app = new ServerApp([
    GET('/vercel/callback', async ({ params }) => {
      const { state, code } = params;

      if (state !== generatedState) {
        return Response.BadRequest('Wrong state');
      }

      const Params = {
        client_id: VercelClientID,
        client_secret: VercelClientSecret,
        code,
        redirect_uri: RedirectURI,
      };

      try {
        const data: any = await got
          .post('https://api.vercel.com/v2/oauth/access_token', {
            form: Params,
          })
          .json();

        const { access_token: accessToken, team_id: teamId } = data;

        await Config.set('vercel_token', `Bearer ${accessToken}`);
        await Config.set('vercel_team_id', teamId);
        printlnSuccess(chalk.bold('success'));
      } catch (error: any) {
        console.log(error.message);
        console.log(
          chalk(
            'Tip: in some cases',
            chalk.green('saleor logout'),
            'followed by',
            chalk.green('saleor login'),
            'may help'
          )
        );

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

      // spinner.succeed(`You've successfully logged into Saleor Cloud!\n  Your access token has been safely stored, and you're ready to go`)
      emitter.emit('finish');

      return {
        body: successPage(
          'You\'ve successfully authenticated Vercel with the Saleor CLI!'
        ),
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
    await delay(1500);
    await app.stop();
  });
};
