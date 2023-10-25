import fs from 'fs/promises';
import chalk from 'chalk';
import Debug from 'debug';
import kebabCase from 'lodash.kebabcase';
import { customAlphabet } from 'nanoid';
import ora from 'ora';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import { Arguments, CommandBuilder } from 'yargs';

import * as Config from '../../config.js';
import { run } from '../../lib/common.js';
import { gitCopy } from '../../lib/download.js';
import { setupGitRepository } from '../../lib/git.js';
import { API, DefaultRegion, GET, POST } from '../../lib/index.js';
import {
  capitalize,
  checkPnpmPresence,
  getSortedServices,
  obfuscateArgv,
  println,
  printlnSuccess,
} from '../../lib/util.js';
import {
  useInstanceValidator,
  useOrganization,
  useToken,
} from '../../middleware/index.js';
import { StoreCreate, User } from '../../types.js';
import { createEnvironment } from '../env/create.js';

const debug = Debug('saleor-cli:storefront:create');

export const command = 'create [name]';
export const desc = 'Bootstrap example [name]';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: true,
    default: 'saleor-storefront',
  })
    .option('demo', {
      type: 'boolean',
      default: false,
      desc: 'specify demo process',
    })
    .option('environment', {
      type: 'string',
      desc: 'specify environment id',
    })
    .option('template', {
      type: 'string',
      default: Config.SaleorStorefrontRepo,
      alias: ['t'],
    })
    .option('branch', {
      type: 'string',
      default: Config.SaleorStorefrontDefaultBranch,
      alias: 'b',
    });

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  debug('command arguments: %O', obfuscateArgv(argv));

  if (argv.demo) {
    debug('demo mode');

    const _argv = {
      ...argv,
      ...(await useOrganization({
        ...argv,
        ...(await useToken(argv)),
      })),
    };

    debug('creating project');
    const project = await createProject(_argv);
    debug('preparing the environment');
    const { domain } = await prepareEnvironment(_argv, project);

    debug('creating storefront');
    await createStorefront({ ..._argv, instance: `https://${domain}` });
  } else {
    debug('creating storefront');
    await createStorefront(argv);
  }
};

const createProject = async (argv: Arguments<StoreCreate>) => {
  const projects = (await GET(API.Project, argv)) as any[];
  const demoName = capitalize(argv.name || 'saleor demo');

  if (projects.filter(({ name }) => name === demoName).length > 0) {
    printlnSuccess(
      chalk(chalk.bold('Select Project  ·'), chalk.cyan(demoName)),
    );
    const project = projects.filter(({ name }) => name === demoName)[0];
    return { slug: project.slug };
  }

  const project = (await POST(API.Project, argv, {
    json: {
      name: demoName,
      plan: 'dev',
      region: DefaultRegion,
    },
  })) as any;

  printlnSuccess(chalk(chalk.bold('Select Project  ·'), chalk.cyan(demoName)));

  return project;
};

const prepareEnvironment = async (
  argv: Arguments<StoreCreate>,
  project: any,
) => {
  const user = (await GET(API.User, argv)) as User;
  const services = await getSortedServices({
    token: argv.token || '',
  });

  const service = services.filter(
    ({ service_type: serviceType }) => serviceType === 'SANDBOX',
  )[0];

  const name = `${project.slug}-${nanoid(8).toLocaleLowerCase()}`;

  printlnSuccess(
    chalk(chalk.bold('Select the database template ·'), chalk.cyan('sample')),
  );
  printlnSuccess(
    chalk(
      chalk.bold('Select a Saleor version ·'),
      chalk.cyan(
        `Saleor ${service.version} - ${service.display_name} - ${service.service_type}`,
      ),
    ),
  );
  printlnSuccess(chalk(chalk.bold('Environment name ·'), chalk.cyan(name)));
  printlnSuccess(chalk(chalk.bold('Environment domain ·'), chalk.cyan(name)));
  printlnSuccess(
    chalk(
      chalk.bold('Would you like to enable dashboard access  (y/N) ·'),
      chalk.cyan('yes'),
    ),
  );
  printlnSuccess(
    chalk(chalk.bold('Dashboard admin email ·'), chalk.cyan(user.email)),
  );
  printlnSuccess(
    chalk(
      chalk.bold(
        'Would you like to restrict your Environment API with Basic Auth? (y/N) ·',
      ),
      chalk.cyan('no'),
    ),
  );

  const json = {
    name,
    domain: name,
    email: user.email,
    project: project.slug,
    database: 'sample',
    saleor: service.name,
    deploy: false,
    restore: false,
    restoreFrom: '',
  };

  const environment = await createEnvironment({
    ...argv,
    ...json,
    ...{
      skipRestrict: true,
    },
  });

  return environment;
};

export const createStorefront = async (argv: Arguments<StoreCreate>) => {
  await checkPnpmPresence('storefront project');

  const { name, template, branch, instance } = argv;

  const spinner = ora('Downloading...').start();
  const target = await getFolderName(sanitize(name));
  await gitCopy(template, target, branch);

  process.chdir(target);
  spinner.text = 'Creating .env...';

  await replace.replaceInFile({
    files: 'package.json',
    from: /("name": "(react|saleor)-storefront").*/g,
    to: `"name": "${kebabCase(target)}",`,
  });

  if (instance) {
    await fs.copyFile('.env.example', '.env');
    await replace.replaceInFile({
      files: '.env',
      from: /NEXT_PUBLIC_SALEOR_API_URL=.*/g,
      to: `NEXT_PUBLIC_SALEOR_API_URL=${instance}`,
    });
  }

  await setupGitRepository(spinner);

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i'], { cwd: process.cwd() });

  spinner.succeed(
    chalk(
      'Your Saleor Storefront Example is ready in the',
      chalk.yellow(target),
      'directory\n',
    ),
  );

  if (!instance) {
    println(chalk.bold('  To finalize prepare the `.env` file:\n'));
    println(`    cd ${target}`);
    println('    cp .env.example .env');
    println(
      '    set NEXT_PUBLIC_SALEOR_API_URL value to your Saleor GraphQL endpoint URL\n',
    );
  }

  println(chalk.bold('  To setup payments:\n'));
  println('    install and configure the Saleor payment App in your dashboard');
  if ((instance || '').includes('saleor.cloud/graphql/')) {
    println(`    ${instance.replace('graphql/', '')}dashboard/apps/`);
  }

  println(
    chalk('\n', chalk.bold(' To start your Saleor Storefront Example:\n')),
  );
  println(`    cd ${target}`);
  println('    pnpm dev\n');
};

const getFolderName = async (name: string): Promise<string> => {
  let folderName = name;
  while (await dirExists(folderName)) {
    folderName = folderName.concat('-0');
  }
  return folderName;
};

const dirExists = async (name: string): Promise<boolean> => {
  try {
    await fs.access(name);
    return true;
  } catch (error) {
    return false;
  }
};

export const middlewares = [useInstanceValidator];
