import chalk from 'chalk';
import Debug from 'debug';
import { access } from 'fs/promises';
import kebabCase from 'lodash.kebabcase';
import { customAlphabet } from 'nanoid';
import ora from 'ora';
import replace from 'replace-in-file';
import sanitize from 'sanitize-filename';
import { Arguments, CommandBuilder } from 'yargs';

import * as Config from '../../config.js';
import { run } from '../../lib/common.js';
import { downloadFromGitHub } from '../../lib/download.js';
import { API, GET, POST } from '../../lib/index.js';
import {
  capitalize,
  checkPnpmPresence,
  getSortedServices,
  obfuscateArgv,
} from '../../lib/util.js';
import { useOrganization, useToken } from '../../middleware/index.js';
import { StoreCreate } from '../../types.js';
import { setupGitRepository } from '../app/create.js';
import { createEnvironment } from '../env/create.js';

const debug = Debug('saleor-cli:storefront:create');

export const command = 'create [name]';
export const desc = 'Bootstrap example [name]';

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: true,
    default: 'saleor-demo',
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
    .option('repository', {
      type: 'string',
      default: Config.SaleorStorefrontRepo,
      alias: ['repo', 'r'],
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
    const environment = await prepareEnvironment(_argv, project);
    debug('creating storefront');
    await createStorefront(_argv);
  } else {
    debug('creating storefront');
    await createStorefront(argv);
  }
};

const createProject = async (argv: Arguments<StoreCreate>) => {
  const projects = (await GET(API.Project, argv)) as any[];
  const demoName = capitalize(argv.name || 'saleor demo');

  if (projects.filter(({ name }) => name === demoName).length > 0) {
    console.log(
      chalk.green('✔'),
      chalk.bold('Select Project  ·'),
      chalk.cyan(demoName)
    );
    const project = projects.filter(({ name }) => name === demoName)[0];
    return { slug: project.slug };
  }

  const project = (await POST(API.Project, argv, {
    json: {
      name: demoName,
      plan: 'dev',
      region: 'us-east-1',
    },
  })) as any;

  console.log(
    chalk.green('✔'),
    chalk.bold('Select Project  ·'),
    chalk.cyan(demoName)
  );

  return project;
};

const prepareEnvironment = async (
  argv: Arguments<StoreCreate>,
  project: any
) => {
  const user = (await GET(API.User, argv)) as any;
  const services = (await getSortedServices(argv)) as any[];

  const service = services.filter(
    ({ service_type: serviceType }) => serviceType === 'SANDBOX'
  )[0];

  const name = `${project.slug}-${nanoid(8).toLocaleLowerCase()}`;

  console.log(
    chalk.green('✔'),
    chalk.bold('Select the database template ·'),
    chalk.cyan('sample')
  );
  console.log(
    chalk.green('✔'),
    chalk.bold('Select a Saleor version ·'),
    chalk.cyan(
      `Saleor ${service.version} - ${service.display_name} - ${service.service_type}`
    )
  );
  console.log(
    chalk.green('✔'),
    chalk.bold('Environment name ·'),
    chalk.cyan(name)
  );
  console.log(
    chalk.green('✔'),
    chalk.bold('Environment domain ·'),
    chalk.cyan(name)
  );
  console.log(
    chalk.green('✔'),
    chalk.bold('Would you like to enable dashboard access  (y/N) ·'),
    chalk.cyan('yes')
  );
  console.log(
    chalk.green('✔'),
    chalk.bold('Dashboard admin email ·'),
    chalk.cyan(user.email)
  );
  console.log(
    chalk.green('✔'),
    chalk.bold(
      'Would you like to restrict your Environment API with Basic Auth? (y/N) ·'
    ),
    chalk.cyan('no')
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
    restore_from: '',
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
  await checkPnpmPresence('react-storefront project');

  const { name, repository, branch } = argv;

  const spinner = ora('Downloading...').start();
  const target = await getFolderName(sanitize(name));
  await downloadFromGitHub(repository, target, branch);

  process.chdir(target);
  spinner.text = 'Creating .env...';

  await replace.replaceInFile({
    files: 'package.json',
    from: /("name": "(react|saleor)-storefront").*/g,
    to: `"name": "${kebabCase(target)}",`,
  });

  await setupGitRepository(spinner);

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i'], { cwd: process.cwd() });

  spinner.succeed(
    chalk(
      'Your Saleor Storefront is ready in the',
      chalk.yellow(target),
      'directory\n'
    )
  );

  console.log('  To start your application:\n');
  console.log(`    cd ${target}`);
  console.log('    pnpm dev');
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
    await access(name);
    return true;
  } catch (error) {
    return false;
  }
};
