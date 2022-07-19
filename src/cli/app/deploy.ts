import chalk from 'chalk';
import dotenv from 'dotenv';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import got from 'got';
import ora from 'ora';
import path from 'path';
import { simpleGit } from 'simple-git';
import { Vercel } from 'vercel-sdk';
import type { CommandBuilder } from 'yargs';

import { Config } from '../../lib/config.js';
import { delay } from '../../lib/util.js';
import { useVercel } from '../../middleware/index.js';

export const command = 'deploy';
export const desc = 'Deploy this Saleor App repository to Vercel';

export const builder: CommandBuilder = (_) => _;

export const handler = async () => {
  const { name } = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8')
  );
  console.log(
    `\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )})`
  );

  // 1. Get or create hosted repository
  const repoUrl = await getRepoUrl(name);
  const { owner, name: repoName } = GitUrlParse(repoUrl);

  console.log('\nDeploying to Vercel');
  // 2. Create a project in Vercel
  const { projectId, newProject } = await createProjectInVercel(
    name,
    owner,
    repoName
  );

  const { vercel_token: vercelToken } = await Config.get();

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

  const vercel = Vercel(vercelToken, projectId);

  // 3. set ENV vars
  vercel.setEnvironmentVariables([
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
  await triggerDeploymentInVercel(name, owner, projectId, newProject);

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
        createRepository(input: {name: $name, visibility: PRIVATE }) {
          repository {
            url
            sshUrl
          }
        }
      }`,
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

const updateEnvironmentVariables = async (name: string) => {
  const { vercel_token: vercelToken } = await Config.get();

  const localEnvs = dotenv.parse(
    await fs.readFile(path.join(process.cwd(), '.env'))
  );

  const { envs: vercelEnvs } = await got
    .get(`https://api.vercel.com/v9/projects/${name}/env`, {
      headers: {
        Authorization: vercelToken,
      },
    })
    .json();

  for (const [localKey, localValue] of Object.entries(localEnvs)) {
    // FIXME handle multiple envs with the same key
    const [vercelEnv] = vercelEnvs.filter(
      ({ key }: { key: string }) => key === localKey
    );

    // new env, create
    if (vercelEnv === undefined) {
      console.log(`Creating new environment variable - ${localKey}`);
      await got.post(`https://api.vercel.com/v9/projects/${name}/env`, {
        headers: {
          Authorization: vercelToken,
        },
        json: {
          key: localKey,
          value: localValue,
          target: ['production', 'preview', 'development'],
          type: 'plain',
        },
      });

      continue;
    }

    // value changed, update
    if (vercelEnv.value !== localValue) {
      console.log(`Updating environment variable - ${localKey}`);
      await got.patch(
        `https://api.vercel.com/v9/projects/${name}/env/${vercelEnv.id}`,
        {
          headers: {
            Authorization: vercelToken,
          },
          json: {
            value: localValue,
          },
        }
      );

      continue;
    }
  }
};

export const createProjectInVercel = async (
  name: string,
  owner: string,
  repoName: string,
  provider = 'github' // TODO allow gitlab & bitbucket
): Promise<Record<string, any>> => {
  const { vercel_token: vercelToken } = await Config.get();

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
    .map(([key, value]) => `${chalk.dim(key)}=${chalk.cyan(value)}`)
    .join('\n');
  console.log('\n--- Setting the environment variables from `.env` in Vercel');
  console.log(output);

  let projectId;
  let newProject = false;

  try {
    const { id }: any = await got
      .get(`https://api.vercel.com/v9/projects/${name}`, {
        headers: {
          Authorization: vercelToken,
        },
      })
      .json();

    projectId = id;
  } catch (error) {
    // TODO check if `ERR_NON_2XX_3XX_RESPONSE` for `error.code`
    const { id } = await got
      .post('https://api.vercel.com/v9/projects', {
        headers: {
          Authorization: vercelToken,
        },
        json: {
          name,
          environmentVariables,
          gitRepository: {
            type: provider,
            repo: `${owner}/${repoName}`,
          },
          framework: 'nextjs',
        },
      })
      .json();

    newProject = true;
    projectId = id;
  }

  return {
    projectId,
    newProject,
  };
};

export const triggerDeploymentInVercel = async (
  name: string,
  owner: string,
  projectId: string,
  newProject: boolean,
  provider = 'github'
) => {
  const { vercel_token: vercelToken } = await Config.get();
  const git = simpleGit();

  if (!newProject) {
    await updateEnvironmentVariables(name);
  }

  const spinner = ora('Registering the changes in Vercel...').start();

  const {
    pushed: [{ alreadyUpdated }],
  } = await git.push('origin', 'main');
  if (alreadyUpdated) {
    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(name, owner);

    const { url } = await deployVercelProject(name, provider, repoId);

    spinner.succeed('Done');
    console.log(`\nYour Vercel URL: ${url}`);

    process.exit(0);
  }

  await delay(5000);
  spinner.succeed('Done');

  const { deployments } = await got
    .get(`https://api.vercel.com/v6/deployments?projectId=${projectId}`, {
      headers: {
        Authorization: vercelToken,
      },
    })
    .json();

  if (deployments.length > 0) {
    const { url } = deployments[0];
    console.log(`\nYour Vercel URL: ${url}`);
  }
};

const deployVercelProject = async (
  name: string,
  provider: string,
  repoId: number
) => {
  const { vercel_token: vercelToken } = await Config.get();

  const { url } = await got
    .post('https://api.vercel.com/v13/deployments', {
      headers: {
        Authorization: vercelToken,
      },
      json: {
        gitSource: {
          type: provider,
          ref: 'main',
          repoId,
        },
        name,
        target: 'production',
        source: 'import',
      },
    })
    .json();

  return {
    url,
  };
};

export const middlewares = [useVercel];
