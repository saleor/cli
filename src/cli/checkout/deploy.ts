import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { setupSaleorAppCheckout } from '../../lib/deploy.js';
import {
  getEnvironment,
  getEnvironmentGraphqlEndpoint,
} from '../../lib/environment.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';
import { contentBox } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:checkout:deploy');

export const command = 'deploy';
export const desc = 'Deploy `saleor-checkout` to Vercel';

export const builder: CommandBuilder = NoCommandBuilderSetup;

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', argv);

  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  debug(`Saleor endpoint: ${endpoint}`);

  const { vercel_token: vercelToken, vercel_team_id: vercelTeamId } =
    await Config.get();

  debug(`Your Vercel token: ${vercelToken}`);
  const vercel = new Vercel(vercelToken);

  if (!vercelToken) {
    // TODO vercel_team_id
  } else {
    console.log('\nDeploying Checkout to Vercel');
    const { checkoutAppURL, appId } = await setupSaleorAppCheckout(
      endpoint,
      vercel,
      argv
    );

    const { domain } = await getEnvironment(argv);

    const appDashboardURL = `https://${domain}/dashboard/apps/${encodeURIComponent(
      appId
    )}/app`;

    const summary = `
  Your deployment is ready. Some useful links:
  Saleor Dashboard: ${chalk.blue(`https://${domain}/dashboard`)}
  GraphQL Playground: ${chalk.blue(endpoint)}
  Checkout App configuration page:
  ${chalk.blue(appDashboardURL)}

  Now, integrate your storefront with the checkout SPA:
  1. Copy the environment variable below.
  ${chalk.blue(`NEXT_PUBLIC_CHECKOUT_URL=${checkoutAppURL}`)}
  2. Paste it into the .env file in your React storefront.
  3. Re-run the development server.
`;

    contentBox(summary);
  }
};
