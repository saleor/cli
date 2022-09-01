import chalk from 'chalk';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import got from 'got';
import { print } from 'graphql';
import path from 'path';

import { AppDelete } from '../generated/graphql.js';
import { AppInstall } from '../graphql/AppInstall.js';
import { SaleorAppList } from '../graphql/SaleorAppList.js';
import { Config } from './config.js';
import { isPortAvailable } from './detectPort.js';
import { getEnvironmentGraphqlEndpoint } from './environment.js';
import {
  MissingEnvVarError,
  NotSaleorAppDirectoryError,
  SaleorAppInstallError,
} from './util.js';

interface Manifest {
  name: string;
  permissions: string[];
}

export const doSaleorAppDelete = async (argv: any) => {
  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(endpoint, {
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
  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
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
    .post(endpoint, {
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
  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(endpoint, {
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
      console.log(data.toString());
    }
  }
  for await (const data of child.stderr || []) {
    console.error(data.toString());
  }
};

export const verifyEnvVarPresence = async () => {
  const hasDotEnvFile = await fs.pathExists('.env');

  // no .env
  if (!hasDotEnvFile) {
    const msg = chalk(
      chalk.red('No .env file found \n\n'),
      chalk(
        'Create .env file using',
        chalk.green('saleor app attach'),
        'command'
      )
    );

    throw new MissingEnvVarError(msg);
  }

  // check if valid NEXT_PUBLIC_SALEOR_HOST_URL present in .env
  if (hasDotEnvFile) {
    const { NEXT_PUBLIC_SALEOR_HOST_URL } = dotenv.parse(
      await fs.readFile(path.join(process.cwd(), '.env'))
    );

    // no NEXT_PUBLIC_SALEOR_HOST_URL
    if (!NEXT_PUBLIC_SALEOR_HOST_URL) {
      const msg = chalk(
        chalk.red(
          'No NEXT_PUBLIC_SALEOR_HOST_URL variable found in the .env file \n\n'
        ),
        chalk(
          'Update .env file using',
          chalk.green('saleor app attach'),
          'command'
        )
      );

      throw new MissingEnvVarError(msg);
    }

    // verify NEXT_PUBLIC_SALEOR_HOST_URL
    if (NEXT_PUBLIC_SALEOR_HOST_URL) {
      const endpoint = `${NEXT_PUBLIC_SALEOR_HOST_URL}/graphql/`;
      try {
        await fetch(endpoint);
      } catch (err) {
        const msg = chalk(
          chalk.red(
            `Cannot verify the environment's graphql endpoint \n  ${endpoint}\n\n`
          ),
          chalk(
            'Update .env file using',
            chalk.green('saleor app attach'),
            'command'
          )
        );

        throw new MissingEnvVarError(msg);
      }
    }
  }

  return {};
};

export const verifyIsSaleorAppDirectory = async (argv: any) => {
  const isTunnel = ['tunnel', 'generate', 'deploy'].includes(argv._[1]);

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
