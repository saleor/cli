import boxen from 'boxen';
import chalk from 'chalk';
import Debug from 'debug';
import { customAlphabet } from 'nanoid';
import { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { setupSaleorAppCheckout } from '../../lib/deploy.js';
import { getEnvironment } from '../../lib/environment.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';
import { readEnvFile } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:checkout:deploy');

export const command = 'deploy [name]';
export const desc = 'Deploy `saleor-checkout` to Vercel';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

export const builder: CommandBuilder = NoCommandBuilderSetup;

export const handler = async (argv: Arguments<Options & { name: string }>) => {
  debug('command arguments: %O', argv);

  const name = argv.name || `saleor-checkout-${nanoid(8).toLocaleLowerCase()}`;
  debug(`Using the name: ${name}`);
  const { domain } = await getEnvironment(argv);
  const url = `https://${domain}/graphql/`;
  debug(`Saleor endpoint: ${url}`);

  const { vercel_token: vercelToken, vercel_team_id: vercelTeamId } =
    await Config.get();

  debug(`Your Vercel token: ${vercelToken}`);
  const vercel = new Vercel(vercelToken);

  if (!vercelToken) {
    // TODO vercel_team_id
  } else {
    const appName = `${name}-app-checkout`;
    debug(`App name in Vercel: ${appName}`);
    const localEnvs = await readEnvFile();

    console.log('\nDeploying Checkout to Vercel');
    const { checkoutAppURL, authToken, appId } = await setupSaleorAppCheckout(
      `${name}-app-checkout`,
      localEnvs.SALEOR_API_URL,
      vercel,
      argv
    );

    localEnvs.CHECKOUT_APP_URL = checkoutAppURL;
    localEnvs.CHECKOUT_STOREFRONT_URL = `${checkoutAppURL}/checkout-spa`;
    localEnvs.SALEOR_APP_TOKEN = authToken;
    localEnvs.SALEOR_APP_ID = appId;

    const appDashboardURL = `https://${domain}/dashboard/apps/${encodeURIComponent(
      appId
    )}/app`;

    const summary = `
  Your deployment is ready. Some useful links:
  Saleor Dashboard: ${chalk.blue(`https://${domain}/dashboard`)}
  GraphQL Playground: ${chalk.blue(url)}
  Checkout App configuration page:
  ${chalk.blue(appDashboardURL)}

  Now, integrate your storefront with the checkout SPA:
  1. Copy the environment variable below.
  ${chalk.blue(`NEXT_PUBLIC_CHECKOUT_URL=${checkoutAppURL}`)}
  2. Paste it into the .env file in your React storefront.
  3. Re-run the development server.
`;

    console.log(
      boxen(summary, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'yellow',
      })
    );
  }
};
