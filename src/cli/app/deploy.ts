import chalk from 'chalk';
import dotenv from 'dotenv';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import ora from 'ora';
import path from 'path';
import { simpleGit } from 'simple-git';
import type { CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { delay } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import { useVercel } from '../../middleware/index.js';

export const command = 'deploy';
export const desc = 'Deploy this Saleor App repository to Vercel';

export const builder: CommandBuilder = (_) => _;

export const handler = async () => {
  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
  );
  console.log(
    `\nDeploying ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )}) to Vercel`
  );

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

  const response = await fetch('https://appraptor.deno.dev/encrypt', {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
  const encrypted = await response.text();

  // 3. set ENV vars
  vercel.setEnvironmentVariables(projectId, [
    {
      key: 'SALEOR_MARKETPLACE_REGISTER_URL',
      value: 'https://appraptor.deno.dev/register?cloud=vercel',
      target: ['production', 'preview'],
      type: 'plain',
    },
    {
      key: 'SALEOR_MARKETPLACE_TOKEN',
      value: encrypted,
      target: ['production', 'preview'],
      type: 'plain',
    },
  ]);

  // 4. Deploy the project in Vercel
  const url = await triggerDeploymentInVercel(
    vercel,
    name,
    owner,
    projectId,
    newProject
  );

  console.log(
    '\nNext step - Install this Saleor App in your Saleor Dashboard\n'
  );
  console.log(`1. using Saleor Dashboard UI
${chalk.cyan(
  envs.NEXT_PUBLIC_SALEOR_HOST_URL
)}/dashboard/apps/install?manifestUrl=${chalk.yellow(
    encodeURIComponent(`${url}/api/manifest`)
  )}\n`);
  console.log(`2. using the 'app install' command
saleor app install
`);

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
        console.error(`\n ${chalk.red('ERROR')} ${error.message}`);
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
  repoName: string
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
    .map(([key, value]) => `${chalk.dim(key)}=${chalk.cyan(value)} `)
    .join('\n');
  console.log(
    `\nSetting the environment variables from ${chalk.yellow(
      '.env'
    )} in Vercel\n`
  );
  console.log(output);
  console.log('');

  let projectId;
  let newProject = false;

  const project: any = await vercel.getProject(name);

  if (!project.id) {
    const { id } = await vercel.createProject(
      name,
      environmentVariables,
      owner,
      repoName
    );

    newProject = true;
    projectId = id;
  } else {
    projectId = project.id;
  }

  return {
    envs,
    projectId,
    newProject,
  };
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

  const spinner = ora('Starting a deployment in Vercel...').start();

  const {
    pushed: [{ alreadyUpdated }],
  } = await git.push('origin', 'main');
  if (alreadyUpdated) {
    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(name, owner);

    const { url } = await vercel.deploy(name, provider, repoId);

    spinner.succeed('Deployment successfully started.');
    console.log(
      `\n${chalk.yellow(
        'Warning'
      )}: You may need to wait up to a few minutes for the deployment to finish.`
    );
    console.log(`\nYour Vercel URL: ${chalk.cyan(`https://${url}`)}`);

    return `https://${url}`;
  }

  await delay(5000);
  spinner.succeed('Done');

  const { deployments } = await vercel.getDeployments(projectId);

  if (deployments.length > 0) {
    const { url } = deployments[0];
    console.log(`\nYour Vercel URL: ${url}`);
    return `https://${url}`;
  }

  // FIXME properly handle this edge case
  return '';
};

export const middlewares = [useVercel];
