import chalk from 'chalk';
import crypto from 'crypto';
import Debug from 'debug';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import ora, { Ora } from 'ora';
import path from 'path';
import simpleGit from 'simple-git';
import { Arguments } from 'yargs';

import { createAppToken } from '../cli/app/token.js';
import { SaleorAppList } from '../graphql/SaleorAppList.js';
import { Options } from '../types.js';
import { doSaleorAppInstall } from './common.js';
import { Config } from './config.js';
import { contentBox, delay } from './util.js';
import { Deployment, Env, Vercel } from './vercel.js';

const debug = Debug('saleor-cli:lib:deploy');

export const getAppId = async (url: string) => {
  debug(`Getting app id - ${url}`);
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

  debug(`App id ${id}`);

  return id;
};

export const createProjectInVercel = async (
  name: string,
  vercel: Vercel,
  envs: Env[],
  buildCommand: null | string = null,
  rootDirectory: null | string = null
) => {
  try {
    debug('Verify if project exists in Vercel');
    const project = await vercel.getProject(name);

    const spinner = ora(`Creating ${name}...`).start();
    spinner.succeed(`Project ${name} already exists.`);

    return project;
  } catch {
    debug('Project doesn\'t exist in Vercel, creating...');
    const repoUrl = await getRepoUrl(name);
    debug(`Repo URL: ${repoUrl}`);
    const { owner, name: repoName } = GitUrlParse(repoUrl);

    debug(`Owner: ${owner}, repoName: ${repoName}`);

    const spinner = ora(`Creating ${name}...`).start();

    const project = await vercel.createProject(
      name,
      envs,
      owner,
      repoName,
      buildCommand,
      rootDirectory,
      'github'
    );

    spinner.succeed(`Created ${name}`);
    return project;
  }
};

export const getRepoUrl = async (name: string): Promise<string> => {
  const git = simpleGit();
  const remotes = await git.getRemotes(true);
  debug(`No of found remotes: ${remotes.length}`);
  let gitUrl;

  if (remotes.length > 0) {
    gitUrl = (await git.remote(['get-url', 'origin'])) as string;
    debug(`Using origin: ${gitUrl}`);
  } else {
    debug('Local repo doesn\'t exist, creating...');
    gitUrl = await createProjectInGithub(name);
  }

  debug(`Repo url ${gitUrl}`);

  return gitUrl.trim();
};

const createProjectInGithub = async (name: string): Promise<string> => {
  const git = simpleGit();
  const { github_token: GitHubToken } = await Config.get();

  const { githubProjectCreate } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'githubProjectCreate',
    initial: 'yes',
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
    message: 'Creating a project on your GitHub. Do you want to continue?',
  })) as { githubProjectCreate: boolean };

  if (!githubProjectCreate) {
    console.error('Saleor App deployment cancelled by the user');
    process.exit(1);
  }

  let gitRepoUrl;

  interface CreateRepository {
    createRepository: {
      repository: {
        sshUrl: string;
      };
    };
  }

  const { data, errors } = await got
    .post('https://api.github.com/graphql', {
      headers: {
        Authorization: GitHubToken,
      },
      json: {
        query: `mutation doRepositoryCreate($name: String!) {
  createRepository(input: { name: $name, visibility: PRIVATE }) {
          repository {
      url
      sshUrl
    }
  }
} `,
        variables: { name },
      },
    })
    .json<{ data: CreateRepository; errors: Error[] }>();

  if (errors) {
    for (const error of errors) {
      if (error.message === 'Name already exists on this account') {
        console.log(`Pushing to the existing repository '${name}'`);
        const repo = await getGithubRepository(name);
        const {
          viewer: {
            repository: { sshUrl },
          },
        } = repo;
        await git.addRemote('origin', sshUrl);
        gitRepoUrl = sshUrl;
      } else {
        console.error(`\n ${chalk.red('ERROR')} ${error.message} `);
        process.exit(1);
      }
    }
  } else {
    const {
      createRepository: {
        repository: { sshUrl },
      },
    } = data;
    await git.addRemote('origin', sshUrl);
    gitRepoUrl = sshUrl;
  }

  return gitRepoUrl;
};

export const getGithubRepository = async (
  name: string,
  owner: string | undefined = undefined
): Promise<any> => {
  const { github_token: GitHubToken } = await Config.get();

  const query = owner
    ? `query getRepository($name: String!, $owner: String!) {
    repository(name: $name, owner: $owner) {
      url
      sshUrl
      databaseId
    }
  }`
    : `query getRepository($name: String!) {
    viewer {
    repository(name: $name) {
      url
      sshUrl
      databaseId
    }
  }
  }`;

  debug(`Getting repository details for ${name} - ${owner}`);

  const { data } = await got
    .post('https://api.github.com/graphql', {
      headers: { Authorization: GitHubToken },
      json: {
        query,
        variables: { name, owner },
      },
    })
    .json<{ data: unknown }>();

  return data;
};

export const setupSaleorAppCheckout = async (
  url: string,
  vercel: Vercel,
  argv: Arguments<Options>
) => {
  const pkgName = await getPackageName();

  const checkoutName = `${pkgName}-app-checkout`;
  debug(`App name in Vercel: ${checkoutName}`);

  const secret = crypto.randomBytes(256).toString('hex');
  const envs = [
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
  ];

  const repoUrl = await getRepoUrl(pkgName);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  const {
    repository: { databaseId: repoId },
  } = await getGithubRepository(repoName, owner);
  debug(`Repository id ${repoId}`);

  debug('Creating Checkout in Vercel');
  const { env: vercelEnvs, id: projectId } = <{ env: Env[]; id: string }>(
    await createProjectInVercel(
      checkoutName,
      vercel,
      envs,
      'cd ../.. && npx turbo run build --filter="saleor-app-checkout..."',
      'apps/saleor-app-checkout'
    )
  );

  debug('Verifying if app already installed');
  if (vercelEnvs.map(({ key }) => key).includes('SALEOR_APP_ID')) {
    debug('Checkout app already installed in the environment');

    const appId = vercelEnvs.filter(({ key }) => key === 'SALEOR_APP_ID')[0]
      ?.value;
    const authToken = vercelEnvs.filter(
      ({ key }) => key === 'SALEOR_APP_TOKEN'
    )[0]?.value;
    const { name: domain } = await vercel.getProjectDomain(projectId);
    const checkoutAppURL = `https://${domain}`;

    return {
      checkoutAppURL,
      appId,
      authToken,
    };
  }

  debug('Checkout app not installed in the environment');

  const deployment = await triggerDeploymentInVercel(
    vercel,
    checkoutName,
    owner,
    projectId
  );

  const deploymentId = deployment.id || deployment.uid;
  await vercel.verifyDeployment(checkoutName, deploymentId);

  const { alias } = await vercel.getDeployment(deploymentId);
  const checkoutAppURL = `https://${alias[0]}`;
  const apiURL = `${checkoutAppURL}/api`;

  // INSTALL APP IN CLOUD ENVIRONMENT
  await doCheckoutAppInstall(
    { ...argv, saleorApiUrl: url },
    apiURL,
    checkoutName
  );
  const appId = await getAppId(url);
  const authToken = await createAppToken(url, appId);

  // CREATE SALEOR_APP_ID & SALEOR_APP_TOKEN variables in CHECKOUT APP
  const appVars: Env[] = [
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

  debug('Setting SALEOR_APP_ID & SALEOR_APP_TOKEN in Vercel');
  await vercel.addEnvironmentVariables(projectId, appVars);

  // REDEPLOY
  debug('Redeploying');
  const { id: redeploymentId } = await vercel.deploy(
    checkoutName,
    'github',
    repoId
  );
  await vercel.verifyDeployment(checkoutName, redeploymentId, 'Redeploying');

  return {
    checkoutAppURL,
    appId,
    authToken,
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
  await doSaleorAppInstall({ ...argv, manifestURL, appName });
  spinner.succeed(`Installed ${appName} in the ${environment} environment`);
  await delay(2000);
};

export const triggerDeploymentInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  projectId: string,
  provider = 'github'
) => {
  const git = simpleGit();

  const spinner = ora('Preparing to deploy...').start();

  debug('Pushing code to repository');
  const { pushed } = await git.push('origin', 'main');

  if (pushed[0]?.alreadyUpdated) {
    const repoUrl = await getRepoUrl(name);
    const { name: repoName } = GitUrlParse(repoUrl);

    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(repoName, owner);

    const deployment = await vercel.deploy(name, provider, repoId);
    displayURLs(spinner, deployment);
    return deployment;
  }

  debug('Waiting for the deployment to be created');
  let loop = true;
  do {
    await delay(1000);

    try {
      const { deployments } = await vercel.getDeployments(projectId);

      if (deployments.length > 0) {
        const deployment = deployments[0];
        displayURLs(spinner, deployment);
        loop = false;
        debug(`Deployment created ${deployment.uid}`);
        return deployment;
      }
    } catch {
      return {};
    }
  } while (loop);

  return {};
};

const displayURLs = (spinner: Ora, deployment: Deployment) => {
  spinner.succeed('App successfully queued for deployment');
  console.log('');

  const msg1 = chalk.blue(`https://${deployment.url}`);

  contentBox(msg1, 'Deployment URL');
  console.log('');
};

export const formatEnvironmentVariables = (envs: {}) =>
  Object.entries(envs).map(
    ([key, value]) =>
      ({
        key,
        value,
        target: ['production', 'preview'],
        type: 'encrypted',
      } as Env)
  );

export const getPackageName = async () => {
  debug('extracting the `name` from `package.json`');

  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
  );

  return name;
};
