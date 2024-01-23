import Debug from 'debug';
import type { CancelableRequest, OptionsOfTextResponseBody } from 'got';
import got from 'got';
import { Argv, CommandBuilder } from 'yargs';

import { Options } from '../types.js';
import { Config } from './config.js';

const debug = Debug('saleor-cli:lib:index');

export const getCloudApiUrl = async () => {
  if (await isLoggedIn()) {
    const { cloud_api_url: cloudApiUrl } = await Config.get();
    return cloudApiUrl;
  }

  return (
    process.env.SALEOR_CLI_ENV_URL || 'https://cloud.saleor.io/platform/api'
  );
};

export const getCloudApiAuthDomain = async () => {
  if (await isLoggedIn()) {
    const { cloud_api_auth_domain: cloudApiAuthDomain } = await Config.get();
    return cloudApiAuthDomain;
  }

  return process.env.SALEOR_CLI_ENV_AUTH_DOMAIN || 'auth.saleor.io';
};

export const isLoggedIn = async () => {
  const { token } = await Config.get();
  return !!token;
};

export const getEnvironment = async () => {
  const { saleor_env: saleorEnv, token } = await Config.get();
  if (token) {
    return saleorEnv;
  }

  return process.env.SALEOR_CLI_ENV || 'production';
};

type DefaultURLPath = (_: Options) => string;

const handleAuthAndConfig =
  (
    func: (
      path: string,
      options?: OptionsOfTextResponseBody,
    ) => CancelableRequest,
  ) =>
  async (
    pathFunc: DefaultURLPath,
    argv: Options,
    options: OptionsOfTextResponseBody = {},
  ) => {
    const path = pathFunc(argv);
    const environment = await getEnvironment();
    const cloudApiUrl = await getCloudApiUrl();

    debug(path);
    debug('cli options', argv);

    const opts = {
      ...options,
      prefixUrl: cloudApiUrl,
      headers: argv.token
        ? {
            Authorization: `${argv.token}`,
          }
        : {},
    };
    debug('`got` options', opts);

    return func(path, opts) as CancelableRequest;
  };

const doGETRequest = (path: string, options?: OptionsOfTextResponseBody) =>
  got(path, { ...options }).json();
const doPOSTRequest = (path: string, options?: OptionsOfTextResponseBody) =>
  got.post(path, { ...options }).json();
const doDELETERequest = (path: string, options?: OptionsOfTextResponseBody) =>
  got.delete(path, { ...options }).json();
const doPUTRequest = (path: string, options?: OptionsOfTextResponseBody) =>
  got.put(path, { ...options }).json();
const doPATCHRequest = (path: string, options?: OptionsOfTextResponseBody) =>
  got.patch(path, { ...options }).json();

export const GET = handleAuthAndConfig(doGETRequest);
export const POST = handleAuthAndConfig(doPOSTRequest);
export const PUT = handleAuthAndConfig(doPUTRequest);
export const DELETE = handleAuthAndConfig(doDELETERequest);
export const PATCH = handleAuthAndConfig(doPATCHRequest);

export const API: Record<string, DefaultURLPath> = {
  User: () => 'user',
  Organization: (_) => `organizations/${_.organization || ''}`,
  OrganizationPermissions: (_) => `organizations/${_.organization}/permissions`,
  UpgradeEnvironment: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/upgrade`,
  Environment: (_) =>
    `organizations/${_.organization}/environments/${_.environment || ''}`,
  PopulateDatabase: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/populate-database`,
  ClearDatabase: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/clear-database`,
  Task: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/tasks${
      _.params || ''
    }`,
  TaskStatus: (_) => `service/task-status/${_.task}`,
  EnvironmentBackup: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/backups/${
      _.backup || ''
    }`,
  Backup: (_) => `organizations/${_.organization}/backups/${_.backup || ''}`,
  Restore: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/restore`,
  Project: (_) => `organizations/${_.organization}/projects/${_.project || ''}`,
  PaymentMethod: (_) =>
    `organizations/${_.organization}/payment-methods/${_.paymentMethod || ''}`,
  Region: (_) => `regions/${_.region || ''}`,
  Services: (_) => `regions/${_.region}/services/${_.serviceName || ''}`,
  Plan: (_) => `plans/${_.plan || ''}`,
  Token: () => 'tokens',
  DomainCheck: () => 'env-domain-check',
};

export const NoCommandBuilderSetup: CommandBuilder = (_: Argv) => _;

export const DefaultRegion = 'us-east-1';
export type Plan = 'startup' | 'pro' | 'dev' | 'enterprise' | 'staging';
export const DefaultSaleorEndpoint = 'https://vercel.saleor.cloud/graphql/';
