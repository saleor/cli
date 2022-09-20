import chalk from 'chalk';
import Debug from 'debug';
import GitUrlParse from 'git-url-parse';
import type { CommandBuilder } from 'yargs';
import { Arguments } from 'yargs';

import { Config } from '../../lib/config.js';
import {
  createProject,
  formatEnvironmentVariables,
  getPackageName,
  getRepoUrl,
  setupSaleorAppCheckout,
  triggerDeploymentInVercel,
} from '../../lib/deploy.js';
import { getEnvironmentGraphqlEndpoint } from '../../lib/environment.js';
import { Vercel } from '../../lib/vercel.js';
import {
  useEnvironment,
  useGithub,
  useVercel,
} from '../../middleware/index.js';
import { StoreDeploy } from '../../types.js';

const debug = Debug('saleor-cli:storefront:deploy');

export const command = 'deploy';
export const desc = 'Deploy this `react-storefront` to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('dispatch', {
    type: 'boolean',
    demandOption: false,
    default: false,
    desc: 'dispatch deployment and don\'t wait till it ends',
  }).option('with-checkout', {
    type: 'boolean',
    default: false,
    desc: 'Deploy with checkout',
  });

export const handler = async (argv: Arguments<StoreDeploy>) => {
  const name = await getPackageName();

  console.log(
    `\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )})`
  );

  const { vercel_token: vercelToken } = await Config.get();
  debug(`Your Vercel token: ${vercelToken}`);

  const vercel = new Vercel(vercelToken);
  const repoUrl = await getRepoUrl(name);

  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  debug(`Saleor endpoint: ${endpoint}`);

  const envs = {
    SALEOR_API_URL: endpoint,
  };

  if (argv.withCheckout) {
    console.log('\nDeploying Checkout to Vercel');
    const { checkoutAppURL, authToken, appId } = await setupSaleorAppCheckout(
      endpoint,
      vercel,
      argv
    );

    Object.assign(envs, {
      CHECKOUT_APP_URL: checkoutAppURL,
      CHECKOUT_STOREFRONT_URL: `${checkoutAppURL}/checkout-spa`,
      SALEOR_APP_TOKEN: authToken,
      SALEOR_APP_ID: appId,
    });
  }

  console.log('\nDeploying Storefront to Vercel');
  const { id } = await createProject(
    name,
    vercel,
    formatEnvironmentVariables(envs),
    'storefront'
  );
  debug(`created a project in Vercel: ${id}`);

  const { name: domain } = await vercel.getProjectDomain(id);
  Object.assign(envs, {
    STOREFRONT_URL: `https://${domain}`,
  });

  debug('triggering the deployment');
  const { owner } = GitUrlParse(repoUrl);
  const deployment = await triggerDeploymentInVercel(vercel, name, owner, id);

  const shouldWaitUntilDeployed = !!process.env.CI || !argv.dispatch;
  if (shouldWaitUntilDeployed) {
    const deploymentId = deployment.id || deployment.uid;
    await vercel.verifyDeployment(name, deploymentId);
  }
};

export const middlewares = [useVercel, useGithub, useEnvironment];
