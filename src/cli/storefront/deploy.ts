import chalk from 'chalk';
import Debug from 'debug';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import path from 'path';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { Vercel } from '../../lib/vercel.js';
import { useGithub, useVercel } from '../../middleware/index.js';
import { Options } from '../../types.js';
import {
  createProjectInVercel,
  getGithubRepository,
  getRepoUrl,
  triggerDeploymentInVercel,
} from '../app/deploy.js';
import { setupCheckout, setupSaleorAppCheckout } from '../checkout/deploy.js';

const debug = Debug('saleor-cli:storefront:deploy');

export const command = 'deploy';
export const desc = 'Deploy this `react-storefront` to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('with-checkout', {
    type: 'boolean',
    default: false,
    desc: 'specify checkout deployment',
  });

export const handler = async (argv: Arguments<Options>) => {
  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
  );
  console.log(
    `\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )})`
  );

  const localEnvs = dotenv.parse(
    await fs.readFile(path.join(process.cwd(), '.env'))
  );

  const repoUrl = await getRepoUrl(name);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  const { vercel_token: vercelToken } = await Config.get();
  debug(`Your Vercel token: ${vercelToken}`);

  const vercel = new Vercel(vercelToken);
  console.log('\nDeploying to Vercel');

  // 2. Create a project in Vercel
  const { projectId, newProject } = await createProjectInVercel(
    vercel,
    name,
    owner,
    repoName,
    'cd ../.. && npx turbo run build --filter="storefront..."',
    'apps/storefront'
  );
  debug(`created a project in Vercel: ${projectId}`);

  // 3. Deploy the project in Vercel
  debug('triggering the deployment');

  // SET ENV FOR SALEOR INSTANCE !!!!
  const deployment = await triggerDeploymentInVercel(
    vercel,
    name,
    owner,
    projectId,
    newProject
  );

  if (argv.withCheckout) {
    const deploymentId = deployment.id || deployment.uid;
    await vercel.verifyDeployment(name, deploymentId);
    const domain = await vercel.getProjectDomain(projectId);
    localEnvs.STOREFRONT_URL = domain;

    // get and set STOREFRONT URL

    // SALEOR_API_URL=https://wb-t-3-4-6.staging.saleor.cloud/graphql/
    // STOREFRONT_URL=http://localhost:3000
    // CHECKOUT_APP_URL=http://localhost:3001
    // CHECKOUT_STOREFRONT_URL=http://localhost:3001/checkout-spa
    // SALEOR_APP_TOKEN=

    // SEPARATE PROJECTS

    // saleor-app-checkout
    const { checkoutAppURL, authToken } = await setupSaleorAppCheckout(
      vercelToken,
      `${name}-app-checkout`,
      localEnvs.SALEOR_API_URL,
      vercel,
      argv
    );

    localEnvs.CHECKOUT_APP_URL = checkoutAppURL;
    localEnvs.SALEOR_APP_TOKEN = authToken;

    // TODO update local .env

    const { checkoutAlias } = await setupCheckout(
      vercelToken,
      `${name}-checkout`,
      checkoutAppURL,
      localEnvs.SALEOR_API_URL,
      vercel
    );

    const envs = Object.entries(localEnvs).map(([key, value]) => ({
      key,
      value,
      target: ['production', 'preview'],
      type: 'encrypted',
    }));

    await vercel.setEnvironmentVariables(projectId, envs);
    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(name, owner);
    await vercel.deploy(name, 'github', repoId);
  }

  process.exit(0);
};

export const middlewares = [useVercel, useGithub];
