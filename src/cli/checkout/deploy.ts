import boxen from 'boxen';
import chalk from 'chalk';
import crypto from 'crypto';
import got from 'got';
import { customAlphabet } from 'nanoid';
import ora from 'ora';
import { Arguments, CommandBuilder } from 'yargs';

import { SaleorAppList } from '../../graphql/SaleorAppList.js';
import { doSaleorAppInstall } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { API, GET } from '../../lib/index.js';
import { delay } from '../../lib/util.js';
import { Options } from '../../types.js';
import { createAppToken } from '../app/token.js';

export const command = 'deploy [name]';
export const desc = 'Deploy `saleor-checkout` to Vercel';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options & { name: string }>) => {
  const name = argv.name || `saleor-checkout-${nanoid(8).toLocaleLowerCase()}`;
  const { domain } = (await GET(API.Environment, argv)) as any;
  const url = `https://${domain}/graphql/`;

  const { vercel_token: vercelToken, vercel_team_id: vercelTeamId } =
    await Config.get();

  if (!vercelToken) {
    // TODO vercel_team_id
  } else {
    // console.log("Using Vercel API")
    const appName = `${name}-app`;

    // SETUP CHECKOUT APP
    await createCheckoutApp(vercelToken, appName, url);
    const checkoutAppDeploymentId = await deployVercelProject(
      vercelToken,
      appName
    );
    await verifyDeployment(vercelToken, appName, checkoutAppDeploymentId);
    const { alias } = await getDeployment(vercelToken, checkoutAppDeploymentId);
    const checkoutAppURL = `https://${alias[0]}`;
    const apiURL = `${checkoutAppURL}/api`;

    // INSTALL APP IN CLOUD ENVIRONMENT
    await doCheckoutAppInstall(argv, apiURL, appName);
    const appId = await getAppId(url);
    const authToken = await createAppToken(url, appId);

    // CREATE SALEOR_APP_ID & SALEOR_APP_TOKEN variables in CHECKOUT APP
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
    const checkoutAppRedeploymentId = await deployVercelProject(
      vercelToken,
      appName
    );
    await verifyDeployment(
      vercelToken,
      appName,
      checkoutAppRedeploymentId,
      'Redeploying'
    );

    // SETUP CHECKOUT CRA
    await createCheckout(vercelToken, name, checkoutAppURL, url);
    const checkoutDeploymentId = await deployVercelProject(vercelToken, name);
    await verifyDeployment(vercelToken, name, checkoutDeploymentId);
    const { alias: checkoutAlias } = await getDeployment(
      vercelToken,
      checkoutDeploymentId
    );

    const appDashboardURL = encodeURIComponent(
      `https://${domain}/dashboard/apps/${appId}/app`
    );
    const checkoutURL = `https://${checkoutAlias[0]}`;

    const summary = `
   Saleor Dashboard: ${chalk.blue(`https://${domain}/dashboard`)}
 GraphQL Playground: ${chalk.blue(url)}
Vercel checkout app: ${chalk.blue(checkoutAppURL)}
    Vercel checkout: ${chalk.blue(checkoutURL)}

Checkout App configuration page:
${chalk.blue(appDashboardURL)}

Update your react-storefront's environment variable
${chalk.blue(`NEXT_PUBLIC_CHECKOUT_URL=${checkoutURL}`)}
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
    .json();

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
            key: 'CHECKOUT_APP_URL',
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
        devCommand: null,
        rootDirectory: null,
        outputDirectory: 'apps/checkout/build',
        buildCommand: 'pnpm run build --scope="checkout-app"',
        installCommand: null,
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
        devCommand: null,
        rootDirectory: 'apps/checkout-app',
        outputDirectory: null,
        buildCommand: 'pnpm run build',
        installCommand: null,
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

const getDeployment = async (
  vercelToken: string,
  deploymentId: string
): Promise<any> => {
  const data = await got
    .get(`https://api.vercel.com/v13/deployments/${deploymentId}`, {
      headers: {
        Authorization: vercelToken,
      },
    })
    .json();

  return data;
};

const verifyDeployment = async (
  vercelToken: string,
  name: string,
  deploymentId: string,
  msg = 'Deploying'
) => {
  const spinner = ora(`${msg} ${name}...`).start();
  let { readyState } = await getDeployment(vercelToken, deploymentId);
  deploymentFailed(readyState);

  while (deploymentSucceeded(readyState)) {
    await delay(5000);
    const { readyState: rs } = await getDeployment(vercelToken, deploymentId);
    readyState = rs;
    deploymentFailed(readyState);
  }

  spinner.succeed(`Deployed ${name}`);
};

const deploymentSucceeded = (readyState: string) => {
  if (readyState === 'READY') {
    return false;
  }

  return true;
};

const deploymentFailed = (readyState: string) => {
  if (['ERROR', 'CANCELED'].includes(readyState)) {
    console.log(`\nDeployment status: ${readyState}`);
    process.exit(1);
  }
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
    .json();

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
