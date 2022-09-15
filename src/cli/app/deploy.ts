import chalk from 'chalk';
import Debug from 'debug';
import GitUrlParse from 'git-url-parse';
import type { Arguments, CommandBuilder } from 'yargs';

import { verifyIsSaleorAppDirectory } from '../../lib/common.js';
import { Config } from '../../lib/config.js';
import {
  formatEnvironmentVariables,
  getPackageName,
  getRepoUrl,
  triggerDeploymentInVercel,
} from '../../lib/deploy.js';
import { getEnvironment } from '../../lib/environment.js';
import { NameMismatchError, readEnvFile } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
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

  const name = await getPackageName();

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
  const localEnvs = await readEnvFile();
  const { id: projectId, newProject } = await vercel.createProject(
    name,
    formatEnvironmentVariables(localEnvs),
    owner,
    repoName
  );

  debug(`Create a Vercel project: ${projectId}`);

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

export const middlewares = [
  verifyIsSaleorAppDirectory,
  useVercel,
  useGithub,
  useToken,
  useOrganization,
  useEnvironment,
];
