import chalk from 'chalk';
import crypto from 'crypto';
import Debug from 'debug';
import Enquirer from 'enquirer';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import ora from 'ora';
import simpleGit from 'simple-git';
import { Arguments } from 'yargs';

import { createAppToken } from '../cli/app/token';
import { SaleorAppList } from '../graphql/SaleorAppList';
import { Options } from '../types';
import { doSaleorAppInstall } from './common';
import { Config } from './config';
import { delay } from './util';
import { Env, Vercel } from './vercel';

const debug = Debug('saleor-cli:lib:deploy');

export const getAppId = async (url: string) => {
  const headers = await Config.getBearerHeader();

  // TODO use queryEnvironment
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

export const createProject = async (
  name: string,
  vercel: Vercel,
  envs: Env[],
  app: string
) => {
  try {
    debug('Verify if project exists in Vercel');
    const project = await vercel.getProject(name);

    project.newProject = false;
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
      `cd ../.. && npx turbo run build --filter="${app}..."`,
      `apps/${app}`,
      'github'
    );
    project.newProject = true;

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
  } else {
    debug('Local repo doesn\'t exist, creating...');
    gitUrl = await createProjectInGithub(name);
  }

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
  appName: string,
  url: string,
  vercel: Vercel,
  argv: Arguments<Options>
) => {
  // SETUP CHECKOUT APP
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

  debug('Creating Checkout in Vercel');
  const { env: vercelEnvs, id: projectId } = <{ env: Env[]; id: string }>(
    await createProject(appName, vercel, envs, 'saleor-app-checkout')
  );

  // Verify if app already installed
  if (vercelEnvs.map(({ key }) => key).includes('SALEOR_APP_ID')) {
    debug('Checkout already exists');
    // app already installed

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

  const repoUrl = await getRepoUrl(appName);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  const {
    repository: { databaseId: repoId },
  } = await getGithubRepository(repoName, owner);

  const { id: deploymentId } = await vercel.deploy(appName, 'github', repoId);
  await vercel.verifyDeployment(appName, deploymentId);

  const { alias } = await vercel.getDeployment(deploymentId);
  const checkoutAppURL = `https://${alias[0]}`;
  const apiURL = `${checkoutAppURL}/api`;

  // INSTALL APP IN CLOUD ENVIRONMENT
  await doCheckoutAppInstall({ ...argv, saleorApiUrl: url }, apiURL, appName);
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

  await vercel.addEnvironmentVariables(projectId, appVars);

  // REDEPLOY
  const { id: redeploymentId } = await vercel.deploy(appName, 'github', repoId);
  await vercel.verifyDeployment(appName, redeploymentId, 'Redeploying');

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
