import path from 'path';
import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import { print } from 'graphql';
import kebabCase from 'lodash.kebabcase';
import ora, { Ora } from 'ora';
import { simpleGit } from 'simple-git';

import { GetApps } from '../generated/graphql.js';
import { Config } from './config.js';
import {
  contentBox,
  delay,
  formatConfirm,
  NameMismatchError,
  SaleorAppError,
} from './util.js';
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
        query: print(GetApps),
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
  rootDirectory: null | string = null,
) => {
  debug('Validating if project name is correct');
  validateVercelProjectName(name);

  try {
    debug('Verifying if project exists in Vercel');
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
      'github',
    );

    spinner.succeed(`Created ${name}`);
    return project;
  }
};

export const getRepoUrl = async (
  name: string,
  githubPrompt = true,
): Promise<string> => {
  const git = simpleGit();
  const remotes = await git.getRemotes(true);
  debug(`No of found remotes: ${remotes.length}`);
  let gitUrl;

  if (remotes.length > 0) {
    gitUrl = (await git.remote(['get-url', 'origin'])) as string;
    debug(`Using origin: ${gitUrl}`);
  } else {
    debug('Local repo doesn\'t exist, creating...');
    gitUrl = await createProjectInGithub(name, githubPrompt);
  }

  debug(`Repo url ${gitUrl}`);

  return gitUrl.trim();
};

const createProjectInGithub = async (
  name: string,
  prompt = true,
): Promise<string> => {
  const git = simpleGit();
  const { github_token: GitHubToken } = await Config.get();

  const { githubProjectCreate } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'githubProjectCreate',
    initial: 'yes',
    format: formatConfirm,
    skip: !prompt,
    message: 'Creating a project on your GitHub. Do you want to continue?',
  })) as { githubProjectCreate: boolean };

  if (!githubProjectCreate) {
    throw new SaleorAppError('Saleor App deployment cancelled by the user');
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
        throw new SaleorAppError(error.message);
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
  owner: string | undefined = undefined,
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

export const triggerDeploymentInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  projectId: string,
  provider = 'github',
) => {
  debug('Validating if project name is correct');
  validateVercelProjectName(name);

  const spinner = ora('Preparing to deploy...').start();

  debug('Pushing code to repository');
  const { pushed } = await pushToRepo(name);

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

  const msg1 = chalk.blue(`  https://${deployment.url}`);

  contentBox(msg1, { title: 'Deployment URL', borderBottom: false });
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
      }) as Env,
  );

export const getPackageName = async () => {
  debug('extracting the `name` from `package.json`');

  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8'),
  );

  return name;
};

const pushToRepo = async (name: string) => {
  const git = simpleGit();

  if (process.env.CI) {
    const repoUrl = await getRepoUrl(name);
    const { source, pathname, owner } = GitUrlParse(repoUrl);
    const repo = `https://${owner}:${process.env.GH_TOKEN?.trim()}@${source}${pathname}`;
    git.remote(['set-url', 'origin', repo]);
  }

  const data = await git.push('origin', 'main');
  return data;
};

export const validateVercelProjectName = (name: string) => {
  const requirements =
    'The name of a Project can only contain up to 100 alphanumeric lowercase characters and hyphens.';

  if (name.length > 99) {
    throw new NameMismatchError(
      `Project name too long - ${name.length} characters.\n Vercel requirements: ${requirements}`,
    );
  }

  if (kebabCase(name) !== name) {
    throw new NameMismatchError(
      `Invalid Project name - ${name}.\n Vercel requirements: ${requirements}`,
    );
  }
};
