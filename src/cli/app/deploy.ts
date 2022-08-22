import boxen from 'boxen';
import chalk from 'chalk';
import dotenv from 'dotenv';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import ora, { Ora } from 'ora';
import path from 'path';
import { simpleGit } from 'simple-git';
import type { Arguments, CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { delay } from '../../lib/util.js';
import { Deployment, Vercel } from '../../lib/vercel.js';
import { useGithub, useVercel } from '../../middleware/index.js';
import { Options } from '../../types.js';

export const command = 'deploy';
export const desc = 'Deploy this Saleor App repository to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('dispatch', {
    type: 'boolean',
    demandOption: false,
    default: false,
    desc: 'dispatch deployment and don\'t wait till it ends',
  })
    .option('register-url', {
      type: 'string',
      demandOption: false,
      default: 'https://appraptor.vercel.app/api/register-app',
      desc: 'specify your own endpoint for registering apps',
    })
    .option('encrypt-url', {
      type: 'string',
      default: 'https://appraptor.vercel.app/api/encrypt',
      demandOption: false,
      desc: 'specify your own endpoint for encrypting tokens',
    });

export const handler = async (argv: Arguments<Options>) => {
  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
  );
  console.log(
    `Deploying ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )})`
  );

  console.log(`Deployment destination: ${chalk.magenta('Vercel')}\n`);

  const { vercel_token: vercelToken } = await Config.get();
  const vercel = new Vercel(vercelToken);

  // 1. Get or create hosted repository
  const repoUrl = await getRepoUrl(name);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  // 2. Create a project in Vercel
  const { projectId, newProject, envs } = await createProjectInVercel(
    vercel,
    name,
    owner,
    repoName
  );

  // encrypt and store in .env
  const value = JSON.stringify({
    access_token: vercelToken.split(' ')[1],
    project: projectId,
  });

  const response = await fetch(argv.encryptUrl!, {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
  const encrypted = await response.text();

  // 3. set ENV vars
  vercel.setEnvironmentVariables(projectId, [
    {
      key: 'SALEOR_MARKETPLACE_REGISTER_URL',
      value: argv.registerUrl!,
      target: ['production', 'preview'],
      type: 'plain',
    },
    {
      key: 'SALEOR_REGISTER_APP_URL',
      value: argv.registerUrl!,
      target: ['production', 'preview'],
      type: 'plain',
    },
    {
      key: 'SALEOR_MARKETPLACE_TOKEN',
      value: encrypted,
      target: ['production', 'preview'],
      type: 'plain',
    },
    {
      key: 'SALEOR_DEPLOYMENT_TOKEN',
      value: encrypted,
      target: ['production', 'preview'],
      type: 'plain',
    },
  ]);

  // 4. Deploy the project in Vercel
  const deployment = await triggerDeploymentInVercel(
    vercel,
    name,
    owner,
    projectId,
    newProject
  );

  const shouldWaitUntilDeployed = !!process.env.CI || !argv.dispatch;
  if (shouldWaitUntilDeployed) {
    const deploymentId = deployment.id || deployment.uid;
    await vercel.verifyDeployment(name, deploymentId);
  }

  const domain = await vercel.getProjectDomain(projectId);

  const projectManifestURL = `https://${domain.name}/api/manifest`;

  const msg1 = `     ${chalk.dim('Using the CLI')}: ${chalk.green(
    'saleor app install'
  )} and pass the following domain ${chalk.yellow(
    projectManifestURL
  )} as Manifest URL`;
  const msg2 = `${chalk.dim(
    'Using Dashboard UI'
  )}: open the following URL in the browser
${chalk.blue(
  envs.NEXT_PUBLIC_SALEOR_HOST_URL
)}/dashboard/apps/install?manifestUrl=${chalk.yellow(
    encodeURIComponent(projectManifestURL)
  )}`;

  console.log(chalk.blue('─').repeat(process.stdout.columns));
  console.log('');
  console.log(` ${msg1}\n\n ${msg2}`);
  console.log('');
  console.log(chalk.blue('─').repeat(process.stdout.columns));

  process.exit(0);
};

export const getRepoUrl = async (name: string): Promise<string> => {
  const git = simpleGit();
  const remotes = await git.getRemotes(true);
  let gitUrl;

  if (remotes.length > 0) {
    gitUrl = (await git.remote(['get-url', 'origin'])) as string;
  } else {
    gitUrl = createProjectInGithub(name);
  }

  return gitUrl;
};

const getGithubRepository = async (
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
    .json();

  return data;
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
    .json();

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

const updateEnvironmentVariables = async (
  vercel: Vercel,
  projectId: string
) => {
  const localEnvs = dotenv.parse(
    await fs.readFile(path.join(process.cwd(), '.env'))
  );

  const envs = Object.entries(localEnvs).map(([key, value]) => ({
    key,
    value,
    target: ['production', 'preview'],
    type: 'encrypted',
  }));

  await vercel.setEnvironmentVariables(projectId, envs);
};

export const createProjectInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  repoName: string,
  buildCommand: null | string = null,
  rootDirectory: null | string = null
): Promise<Record<string, any>> => {
  const envs = dotenv.parse(
    await fs.readFile(path.join(process.cwd(), '.env'))
  );
  const environmentVariables = Object.entries(envs).map(([key, value]) => ({
    key,
    value,
    target: ['production', 'preview', 'development'],
    type: 'plain',
  }));

  const output = Object.entries(envs)
    .map(([key, value]) => `${chalk.dim(key)}: ${chalk.cyan(value)} `)
    .join('\n');

  console.log(
    boxen(output, {
      padding: 1,
      margin: 0,
      borderColor: 'blue',
      borderStyle: 'round',
      title: 'Environment Variables',
    })
  );
  console.log('');

  let projectId;
  let newProject = false;

  try {
    const project: any = await vercel.getProject(name);
    projectId = project.id;
  } catch (error) {
    const { id } = await vercel.createProject(
      name,
      environmentVariables,
      owner,
      repoName,
      buildCommand,
      rootDirectory
    );

    newProject = true;
    projectId = id;
  }

  return {
    envs,
    projectId,
    newProject,
  };
};

const displayURLs = (spinner: Ora, deployment: Deployment) => {
  spinner.succeed('App successfully queued for deployment');
  console.log('');

  const msg1 = chalk.blue(`https://${deployment.url}`);

  console.log(
    boxen(msg1, {
      padding: 1,
      margin: 0,
      borderColor: 'blue',
      borderStyle: 'round',
      title: 'Deployment URL',
    })
  );
  console.log('');
};

export const triggerDeploymentInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  projectId: string,
  newProject: boolean,
  provider = 'github'
) => {
  const git = simpleGit();

  if (!newProject) {
    await updateEnvironmentVariables(vercel, name);
  }

  const spinner = ora('Preparing to deploy...').start();

  const {
    pushed: [{ alreadyUpdated }],
  } = await git.push('origin', 'main');
  if (alreadyUpdated) {
    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(name, owner);

    const deployment = await vercel.deploy(name, provider, repoId);
    displayURLs(spinner, deployment);
    return deployment;
  }

  await delay(5000);

  const { deployments } = await vercel.getDeployments(projectId);

  if (deployments.length > 0) {
    const deployment = deployments[0];
    displayURLs(spinner, deployment);
    return deployment;
  }

  // FIXME properly handle this edge case
  return {};
};

export const middlewares = [useVercel, useGithub];
