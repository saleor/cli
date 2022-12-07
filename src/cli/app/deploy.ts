import chalk from 'chalk';
import Debug from 'debug';
import GitUrlParse from 'git-url-parse';
import fetch from 'node-fetch';
import type { Arguments, CommandBuilder } from 'yargs';

import { verifyIsSaleorAppDirectory } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import {
  createProjectInVercel,
  formatEnvironmentVariables,
  getPackageName,
  getRepoUrl,
  triggerDeploymentInVercel,
  validateVercelProjectName,
} from '../../lib/deploy.js';
import {
  contentBox,
  NameMismatchError,
  obfuscate,
  obfuscateArgv,
} from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import {
  useAppConfig,
  useGithub,
  useInstanceConnector,
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
    })
    .option('github-prompt', {
      type: 'boolean',
      default: 'true',
      demandOption: false,
      desc: 'specify prompt presence for repository creation on Github',
    })
    .option('manifest-path', {
      type: 'string',
      default: '/api/manifest',
      desc: 'The application\'s manifest path',
    })
    .example('saleor app deploy --no-github-prompt', '')
    .example(
      'saleor app deploy --no-github-prompt --manifest-path=/app/manifest',
      ''
    )
    .example(
      'saleor app deploy --organization=organization-slug --environment=env-id-or-name --no-github-prompt',
      ''
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const name = await getPackageName();
  validateVercelProjectName(name);

  console.log(
    `Deploying ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json'
    )})`
  );

  console.log(`Deployment destination: ${chalk.magenta('Vercel')}\n`);

  const { vercel_token: vercelToken } = await Config.get();
  debug(`Your Vercel token: ${obfuscate(vercelToken)}`);
  const vercel = new Vercel(vercelToken);

  const repoURL = await getRepoUrl(name, argv.githubPrompt);
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

  debug(`Saleor API instance endpoint: ${argv.instance}/graphql/`);

  debug('Creating a Vercel project');
  const { id: projectId } = await createProjectInVercel(
    name,
    vercel,
    formatEnvironmentVariables({
      NEXT_PUBLIC_SALEOR_HOST_URL: `${argv.instance}/graphql/`,
    })
  );

  debug(`Created Vercel project: ${projectId}`);

  debug('Encrypting Vercel credentials');
  const response = await fetch(argv.encryptUrl!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      access_token: vercelToken.split(' ')[1],
      project: projectId,
    }),
  });
  const encrypted = await response.text();
  debug('Encrypted the Vercel credentials');

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
    {
      key: 'APL',
      value: 'vercel',
      target: ['production', 'preview'],
      type: 'plain',
    },
  ]);

  debug(`Triggering deployment in Vercel for ${name} with ID: ${projectId}`);
  const deployment = await triggerDeploymentInVercel(
    vercel,
    name,
    owner,
    projectId
  );

  const shouldWaitUntilDeployed = !!process.env.CI || !argv.dispatch;
  if (shouldWaitUntilDeployed) {
    const deploymentId = deployment.id || deployment.uid;
    debug(`Waiting for deployment ${deploymentId}`);
    await vercel.verifyDeployment(name, deploymentId);
  }

  const domain = await vercel.getProjectDomain(projectId);

  const projectManifestURL = `https://${domain.name}${argv.manifestPath}`;

  const msg1 = ` ${chalk.dim('Using the CLI')}: ${chalk.green(
    'saleor app install'
  )} and pass the following domain as Manifest URL\n
  ${chalk.yellow(projectManifestURL)}`;
  const msg2 = `${chalk.dim(
    'Using Dashboard UI'
  )}: open the following URL in the browser\n
  ${chalk.blue(
    argv.instance
  )}/dashboard/apps/install?manifestUrl=${chalk.yellow(
    encodeURIComponent(projectManifestURL)
  )}`;

  contentBox(`${msg1}\n\n ${msg2}`, { title: 'Install the app' });

  await Config.appendCache('apps', projectManifestURL);

  process.exit(0);
};

export const middlewares = [
  verifyIsSaleorAppDirectory,
  useAppConfig,
  useVercel,
  useGithub,
  useInstanceConnector,
];
