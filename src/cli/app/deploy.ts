import boxen from 'boxen';
import chalk from 'chalk';
import Debug from 'debug';
import fs from 'fs-extra';
import GitUrlParse from 'git-url-parse';
import ora, { Ora } from 'ora';
import path from 'path';
import { simpleGit } from 'simple-git';
import type { Arguments, CommandBuilder } from 'yargs';

import { verifyIsSaleorAppDirectory } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import { getGithubRepository, getRepoUrl } from '../../lib/deploy.js';
import { getEnvironment } from '../../lib/environment.js';
import { delay, NameMismatchError, readEnvFile } from '../../lib/util.js';
import { Deployment, Env, Vercel } from '../../lib/vercel.js';
import {
  useEnvironment,
  useGithub,
  useOrganization,
  useToken,
  useVercel,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:deploy');

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
  debug('command arguments: %O', argv);

  debug('extracting the `name` from `package.json` of this Saleor App');
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
  debug(`Your Vercel token: ${vercelToken}`);
  const vercel = new Vercel(vercelToken);

  // 1. Get or create hosted repository
  const repoURL = await getRepoUrl(name);
  debug(`Remote Git repository: ${repoURL}`);
  const { owner, name: repoName } = GitUrlParse(repoURL);

  debug(`Detected package name - "${name}". Repository name - "${repoName}"`);
  if (name !== repoName) {
    throw new NameMismatchError(
      `Name from package.json - ${chalk.red(
        name
      )} - must be the same as the repository name - ${chalk.red(repoName)}`
    );
  }

  // 2. Create a project in Vercel
  const { projectId, newProject } = await createProjectInVercel(
    vercel,
    name,
    owner,
    repoName
  );
  debug(`Create a Vercel project: ${projectId}`);

  const body = JSON.stringify({
    access_token: vercelToken.split(' ')[1],
    project: projectId,
  });

  const response = await fetch(argv.encryptUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
  const encrypted = await response.text();
  debug('Encrypted the Vercel credentials');

  // 3. set ENV vars
  debug(
    'Setting `SALEOR_REGISTER_APP_URL` and `SALEOR_DEPLOYMENT_TOKEN` variables'
  );
  vercel.setEnvironmentVariables(projectId, [
    {
      key: 'SALEOR_REGISTER_APP_URL',
      value: argv.registerUrl!,
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
  debug(`Triggering the deploy in Vercel for ${name} with ID: ${projectId}`);
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

  const environment = await getEnvironment(argv);
  const baseURL = `https://${environment.domain}`;

  const msg1 = `     ${chalk.dim('Using the CLI')}: ${chalk.green(
    'saleor app install'
  )} and pass the following domain ${chalk.yellow(
    projectManifestURL
  )} as Manifest URL`;
  const msg2 = `${chalk.dim(
    'Using Dashboard UI'
  )}: open the following URL in the browser\n
${chalk.blue(baseURL)}/dashboard/apps/install?manifestUrl=${chalk.yellow(
    encodeURIComponent(projectManifestURL)
  )}`;

  console.log(chalk.blue('─').repeat(process.stdout.columns));
  console.log('');
  console.log(` ${msg1}\n\n ${msg2}`);
  console.log('');
  console.log(chalk.blue('─').repeat(process.stdout.columns));

  process.exit(0);
};

// FIXME
export const formatEnvs = (envs: {}) =>
  Object.entries(envs).map(
    ([key, value]) =>
      ({
        key,
        value,
        target: ['production', 'preview'],
        type: 'encrypted',
      } as Env)
  );

const updateEnvironmentVariables = async (
  vercel: Vercel,
  projectId: string
) => {
  const localEnvs = await readEnvFile();
  const envs = formatEnvs(localEnvs);
  await vercel.setEnvironmentVariables(projectId, envs);
};

// TODO verify
export const createProjectInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  repoName: string,
  buildCommand: null | string = null,
  rootDirectory: null | string = null
): Promise<Record<string, any>> => {
  const envs = await readEnvFile();
  const environmentVariables = formatEnvs(envs);

  const output = Object.entries(envs)
    .map(([key, value]) => `${chalk.dim(key)}: ${chalk.cyan(value)} `)
    .join('\n');

  if (Object.keys(envs).length > 0) {
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
  }

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

// TODO verify
export const triggerDeploymentInVercel = async (
  vercel: Vercel,
  name: string,
  owner: string,
  projectId: string,
  newProject: boolean,
  provider = 'github'
) => {
  const git = simpleGit();

  const spinner = ora('Preparing to deploy...').start();

  if (!newProject) {
    await updateEnvironmentVariables(vercel, name);
  }

  const { pushed } = await git.push('origin', 'main');

  if (pushed[0]?.alreadyUpdated) {
    const {
      repository: { databaseId: repoId },
    } = await getGithubRepository(name, owner);

    const deployment = await vercel.deploy(name, provider, repoId);
    displayURLs(spinner, deployment);
    return deployment;
  }

  let loop = true;

  while (loop) {
    await delay(1000);

    try {
      const { deployments } = await vercel.getDeployments(projectId);

      if (deployments.length > 0) {
        const deployment = deployments[0];
        displayURLs(spinner, deployment);
        loop = false;
        return deployment;
      }
    } catch {
      return {};
    }
  }

  return {};
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  useVercel,
  useGithub,
  useToken,
  useOrganization,
  useEnvironment,
];
