import chalk from 'chalk';
import Debug from 'debug';
import GitUrlParse from 'git-url-parse';
import type { CommandBuilder } from 'yargs';
import { Arguments } from 'yargs';

import { Config } from '../../lib/config.js';
import {
  createProjectInVercel,
  formatEnvironmentVariables,
  getPackageName,
  getRepoUrl,
  triggerDeploymentInVercel,
  validateVercelProjectName,
} from '../../lib/deploy.js';
import { obfuscate, obfuscateArgv } from '../../lib/util.js';
import { Vercel } from '../../lib/vercel.js';
import {
  useAppConfig,
  useGithub,
  useInstanceConnector,
  useVercel,
} from '../../middleware/index.js';
import { Deploy } from '../../types.js';

const debug = Debug('saleor-cli:storefront:deploy');

export const command = 'deploy';
export const desc = 'Deploy this `react-storefront` to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('dispatch', {
    type: 'boolean',
    demandOption: false,
    default: false,
    desc: 'dispatch deployment and don\'t wait till it ends',
  })
    .option('github-prompt', {
      type: 'boolean',
      default: 'true',
      demandOption: false,
      desc: 'specify prompt presence for repository creation on Github',
    })
    .example('saleor storefront deploy --no-github-prompt', '')
    .example(
      'saleor storefront deploy --organization=organization-slug --environment=env-id-or-name --no-github-prompt',
      '',
    );

export const handler = async (argv: Arguments<Deploy>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const name = await getPackageName();
  validateVercelProjectName(name);

  console.log(
    `\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow(
      'package.json',
    )})`,
  );

  const { vercel_token: vercelToken } = await Config.get();
  debug(`Your Vercel token: ${obfuscate(vercelToken)}`);

  const vercel = new Vercel(vercelToken);
  const repoUrl = await getRepoUrl(name, argv.githubPrompt);

  const envs = {
    SALEOR_API_URL: argv.instance,
  };

  console.log('\nDeploying Storefront to Vercel');
  const { id } = await createProjectInVercel(
    name,
    vercel,
    formatEnvironmentVariables(envs),
    'cd ../.. && npx turbo run build --filter="storefront..."',
    'apps/storefront',
  );
  debug(`created a project in Vercel: ${id}`);

  const { name: domain } = await vercel.getProjectDomain(id);
  Object.assign(envs, {
    STOREFRONT_URL: `https://${domain}`,
  });

  debug('triggering the deployment');
  const { owner } = GitUrlParse(repoUrl);
  const deployment = await triggerDeploymentInVercel(vercel, name, owner, id);

  const shouldWaitUntilDeployed = !!process.env.CI || !argv.dispatch;
  if (shouldWaitUntilDeployed) {
    const deploymentId = deployment.id || deployment.uid;
    await vercel.verifyDeployment(name, deploymentId);
  }
};

export const middlewares = [
  useAppConfig,
  useVercel,
  useGithub,
  useInstanceConnector,
];
