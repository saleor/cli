import chalk from 'chalk';
import { spawn } from 'child_process';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import got from 'got';
import { print } from 'graphql';

import { AppDelete } from '../generated/graphql.js';
import { AppInstall } from '../graphql/AppInstall.js';
import { SaleorAppList } from '../graphql/SaleorAppList.js';
import { Config } from './config.js';
import { isPortAvailable } from './detectPort.js';
import { API, GET } from './index.js';
import { NotSaleorAppDirectoryError, SaleorAppInstallError } from './util.js';

interface Manifest {
  name: string;
  permissions: string[];
}

export const doSaleorAppDelete = async (argv: any) => {
  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(`https://${domain}/graphql`, {
      headers,
      json: {
        query: print(AppDelete),
        variables: {
          app: argv.app,
        },
      },
    })
    .json();

  if (errors) {
    console.log(errors);
  }

  return data;
};

export const doSaleorAppInstall = async (argv: any) => {
  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  if (!argv.manifestURL) {
    console.log(chalk.green('  Configure your Saleor App'));
  }

  const { manifestURL } = await Enquirer.prompt<{ manifestURL: string }>({
    type: 'input',
    name: 'manifestURL',
    message: 'Manifest URL',
    skip: !!argv.manifestURL,
    initial: argv.manifestURL,
  });

  let manifest: Manifest;
  try {
    manifest = await got.get(manifestURL).json();
  } catch {
    console.log(
      chalk.red('\n There was a problem while fetching provided manifest URL\n')
    );
    process.exit(1);
  }

  const { name } = await Enquirer.prompt<{ name: string }>({
    type: 'input',
    name: 'name',
    message: 'App name',
    skip: !!argv.appName,
    initial: argv.appName ?? manifest.name,
  });

  const { data, errors }: any = await got
    .post(`https://${domain}/graphql`, {
      headers,
      json: {
        query: AppInstall,
        variables: {
          manifestURL,
          name,
          permissions: manifest.permissions,
        },
      },
    })
    .json();

  // TODO
  if (errors || data.appInstall.errors.length > 0) {
    throw new SaleorAppInstallError();
  }

  return data;
};

export const fetchSaleorAppList = async (argv: any) => {
  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(`https://${domain}/graphql`, {
      headers,
      json: {
        query: SaleorAppList,
      },
    })
    .json();

  // TODO
  if (errors) {
    console.log(errors);
  }

  return data;
};

export const run = async (
  cmd: string,
  params: string[],
  options: Record<string, unknown>,
  log = false
) => {
  const winSuffix = process.platform === 'win32' ? '.cmd' : '';
  const child = spawn(`${cmd}${winSuffix}`, params, options);
  for await (const data of child.stdout || []) {
    if (log) {
      console.log(data);
    }
  }
  for await (const data of child.stderr || []) {
    console.error(data);
  }
};

export const verifyIsSaleorAppDirectory = async (argv: any) => {
  const isTunnel = ['tunnel', 'generate'].includes(argv._[1]);

  // check if this is a Next.js app
  const isNodeApp = await fs.pathExists('package.json');
  const isNextApp = await fs.pathExists('next.config.js');
  const hasDotEnvFile = await fs.pathExists('.env');

  if (!isTunnel) {
    return {};
  }

  if (!isNextApp || !isNodeApp || !hasDotEnvFile) {
    throw new NotSaleorAppDirectoryError(
      `'app ${argv._[1]}' must be run from the directory of your Saleor app`
    );
  }

  return {};
};

export const verifyIfSaleorAppRunning = async (argv: any) => {
  const { port } = argv;

  const isFree = await isPortAvailable(Number(port));
  if (isFree) {
    throw new Error(`No Saleor App running on port ${port}`);
  }

  return {};
};
