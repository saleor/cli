import chalk from 'chalk';
import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { setupSaleorAppCheckout } from '../../lib/deploy.js';
import { contentBox, obfuscate, obfuscateArgv } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import { Deploy } from '../../types.js';

const debug = Debug('saleor-cli:checkout:deploy');

export const command = 'deploy';
export const desc = 'Deploy `saleor-checkout` to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('github-prompt', {
    type: 'boolean',
    default: 'true',
    demandOption: false,
    desc: 'specify prompt presence for repository creation on Github',
  })
    .example('saleor checkout deploy --no-github-prompt', '')
    .example(
      'saleor checkout deploy --organization=organization-slug --environment=env-id-or-name --no-github-prompt',
      '',
    );

export const handler = async (argv: Arguments<Deploy>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const domain = argv.instance;
  const endpoint = `${domain}/graphql/`;

  debug(`Saleor API URL: ${domain}`);

  const { vercel_token: vercelToken, vercel_team_id: vercelTeamId } =
    await Config.get();

  debug(`Your Vercel token: ${obfuscate(vercelToken)}`);
  const vercel = new Vercel(vercelToken);

  if (!vercelToken) {
    // TODO vercel_team_id
  } else {
    console.log('\nDeploying Checkout to Vercel');
    const { checkoutAppURL, appId } = await setupSaleorAppCheckout(
      endpoint,
      vercel,
      argv,
    );

    const app = encodeURIComponent(appId);
    const appDashboardURL = `${domain}/dashboard/apps/${app}/app`;

    const summary = `
  Your deployment is ready. Some useful links:
  Saleor Dashboard: ${chalk.blue(`${domain}/dashboard`)}
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
