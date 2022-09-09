import boxen from 'boxen';
import chalk from 'chalk';
import crypto from 'crypto';
import Debug from 'debug';
import got from 'got';
import { customAlphabet } from 'nanoid';
import ora from 'ora';
import { Arguments, CommandBuilder } from 'yargs';

import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { doSaleorAppInstall } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { getEnvironment } from '../../lib/environment.js';
import { NoCommandBuilderSetup } from '../../lib/index.js';
import { delay } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import { Options } from '../../types.js';
import { createAppToken } from '../app/token.js';

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
    // console.log("Using Vercel API")
    const appName = `${name}-app`;
    debug(`App name in Vercel: ${appName}`);

    // SETUP CHECKOUT APP
    await createCheckoutApp(vercelToken, appName, url);
    const checkoutAppDeploymentId = await deployVercelProject(
      vercelToken,
      appName
    );
    await vercel.verifyDeployment(appName, checkoutAppDeploymentId);
    const { alias } = await vercel.getDeployment(checkoutAppDeploymentId);
    const checkoutAppURL = `https://${alias[0]}`;
    debug(`Checkout App URL: ${checkoutAppURL}`);
    const apiURL = `${checkoutAppURL}/api`;

    // INSTALL APP IN CLOUD ENVIRONMENT
    await doCheckoutAppInstall(argv, apiURL, appName);
    const appId = await getAppId(url);
    const authToken = await createAppToken(url, appId);

    // CREATE SALEOR_APP_ID & SALEOR_APP_TOKEN variables in CHECKOUT APP
    debug('Setting `SALEOR_APP_ID` and `SALEOR_APP_TOKEN`');
    const appVars = [
      {
        type: 'encrypted',
        key: 'SALEOR_APP_ID',
        value: appId,
        target: ['production', 'preview', 'development'],
      },
      {
        type: 'encrypted',
        key: 'SALEOR_APP_TOKEN',
        value: authToken,
        target: ['production', 'preview', 'development'],
      },
    ];
    await createVercelEnv(vercelToken, appName, appVars);

    // REDEPLOY
    debug('Re-deploying the checkout');
    const checkoutAppRedeploymentId = await deployVercelProject(
      vercelToken,
      appName
    );
    await vercel.verifyDeployment(
      appName,
      checkoutAppRedeploymentId,
      'Redeploying'
    );

    // SETUP CHECKOUT CRA
    await createCheckout(vercelToken, name, checkoutAppURL, url);
    const checkoutDeploymentId = await deployVercelProject(vercelToken, name);
    await vercel.verifyDeployment(name, checkoutDeploymentId);
    const { alias: checkoutAlias } = await vercel.getDeployment(
      checkoutDeploymentId
    );

    const appDashboardURL = `https://${domain}/dashboard/apps/${encodeURIComponent(
      appId
    )}/app`;
    const checkoutURL = `https://${checkoutAlias[0]}`;

    const summary = `
  Your deployment is ready. Some useful links:
  Saleor Dashboard: ${chalk.blue(`https://${domain}/dashboard`)}
  GraphQL Playground: ${chalk.blue(url)}
  Checkout App configuration page:
  ${chalk.blue(appDashboardURL)}

  Now, integrate your storefront with the checkout SPA:
  1. Copy the environment variable below.
  ${chalk.blue(`NEXT_PUBLIC_CHECKOUT_URL=${checkoutURL}`)}
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

  process.exit(0);
};

const createFork = async () => {
  const { github_token: githubToken } = await Config.get();

  const { id, full_name: fullName } = await got
    .post('https://api.github.com/repos/saleor/saleor-checkout/forks', {
      headers: {
        Authorization: githubToken,
      },
    })
    .json<{ id: string; full_name: string }>();

  return {
    id,
    fullName,
  };
};

const doCheckoutAppInstall = async (
  argv: Options,
  apiURL: string,
  appName: string
) => {
  const { environment } = argv;
  const spinner = ora(
    `Installing ${appName} in the ${environment} environment...`
  ).start();
  const manifestURL = `${apiURL}/manifest`;
  await doSaleorAppInstall({ ...argv, manifestURL, appName: 'Checkout' });
  spinner.succeed(`Installed ${appName} in the ${environment} environment`);
  await delay(2000);
};

const createCheckout = async (
  vercelToken: string,
  name: string,
  checkoutAppUrl: string,
  url: string
) => {
  const spinner = ora(`Creating ${name}...`).start();
  const { fullName } = await createFork();

  const response = await got
    .post('https://api.vercel.com/v8/projects', {
      headers: {
        Authorization: vercelToken,
      },
      json: {
        name,
        environmentVariables: [
          {
            type: 'encrypted',
            key: 'REACT_APP_CHECKOUT_APP_URL',
            value: checkoutAppUrl,
            target: ['production', 'preview', 'development'],
          },
          {
            type: 'encrypted',
            key: 'SALEOR_API_URL',
            value: url,
            target: ['production', 'preview', 'development'],
          },
          {
            type: 'encrypted',
            key: 'REACT_APP_SALEOR_API_URL',
            value: url,
            target: ['production', 'preview', 'development'],
          },
        ],
        gitRepository: {
          type: 'github',
          repo: fullName,
          sourceless: true,
        },
        framework: 'create-react-app',
        buildCommand: 'cd ../.. && npx turbo run build --filter="checkout..."',
        rootDirectory: 'apps/checkout',
      },
    })
    .json();

  spinner.succeed(`Created ${name}`);

  return response;
};

const createCheckoutApp = async (
  vercelToken: string,
  name: string,
  url: string
) => {
  const spinner = ora(`Creating ${name}...`).start();
  const { fullName } = await createFork();

  const secret = crypto.randomBytes(256).toString('hex');

  const response = await got
    .post('https://api.vercel.com/v8/projects', {
      headers: {
        Authorization: vercelToken,
      },
      json: {
        name,
        environmentVariables: [
          {
            type: 'encrypted',
            key: 'SETTINGS_ENCRYPTION_SECRET',
            value: secret,
            target: ['production', 'preview', 'development'],
          },
          {
            type: 'encrypted',
            key: 'SALEOR_API_URL',
            value: url,
            target: ['production', 'preview', 'development'],
          },
          {
            type: 'encrypted',
            key: 'NEXT_PUBLIC_SALEOR_API_URL',
            value: url,
            target: ['production', 'preview', 'development'],
          },
        ],
        gitRepository: {
          type: 'github',
          repo: fullName,
          sourceless: true,
        },
        framework: 'nextjs',
        buildCommand:
          'cd ../.. && npx turbo run build --filter="saleor-app-checkout..."',
        rootDirectory: 'apps/saleor-app-checkout',
      },
    })
    .json();

  spinner.succeed(`Created ${name}`);

  return response;
};

const getAppId = async (url: string) => {
  const headers = await Config.getBearerHeader();

  const {
    data: {
      apps: { edges },
    },
  }: any = await got
    .post(url, {
      headers,
      json: {
        query: SaleorAppList,
        variables: {},
      },
    })
    .json();

  if (!edges) {
    throw console.error('No apps installed');
  }

  const [
    {
      node: { id },
    },
  ] = edges.slice(-1);

  return id;
};

const deployVercelProject = async (vercelToken: string, name: string) => {
  const { id } = await got
    .post('https://api.vercel.com/v13/deployments', {
      headers: {
        Authorization: vercelToken,
      },
      json: {
        gitSource: {
          type: 'github',
          ref: 'main',
          repoId: 450152242, // saleor
        },
        name,
        target: 'production',
        source: 'import',
      },
    })
    .json<{ id: string }>();

  return id;
};

const createVercelEnv = async (
  vercelToken: string,
  name: string,
  json: Record<string, unknown>[] | Record<string, unknown>
) => {
  const data = await got
    .post(`https://api.vercel.com/v9/projects/${name}/env`, {
      headers: {
        Authorization: vercelToken,
      },
      json,
    })
    .json();

  return data;
};
