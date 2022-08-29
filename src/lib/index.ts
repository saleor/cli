import Debug from 'debug';
import type { CancelableRequest } from 'got';
import got from 'got';

import amplifyProdConfig from '../aws-exports-prod.js';
import amplifyStagingConfig from '../aws-exports-staging.js'; // esl
import { ConfigMap, Options } from '../types.js';
import { Config } from './config.js';

const debug = Debug('lib:index');

export const configs: ConfigMap = {
  staging: {
    cloudApiUrl: 'https://staging-cloud.saleor.io/api',
    amplifyConfig: amplifyStagingConfig,
  },
  production: {
    cloudApiUrl: 'https://cloud.saleor.io/api',
    amplifyConfig: amplifyProdConfig,
  },
};

export const getEnvironment = async () => {
  const { saleor_env: saleorEnv } = await Config.get();
  return process.env.SALEOR_CLI_ENV || saleorEnv || 'production';
};

export const getAmplifyConfig = async () => {
  const environment = await getEnvironment();
  const { amplifyConfig } = configs[environment];
  return amplifyConfig;
};

type DefaultURLPath = (_: Options) => string;

const handleAuthAndConfig =
  (func: (path: string, options?: any) => any) =>
  async (pathFunc: DefaultURLPath, argv: Options, options: any = {}) => {
    const path = pathFunc(argv);
    const environment = await getEnvironment();
    const { cloudApiUrl } = configs[environment];

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

const doGETRequest = (path: string, options?: any) =>
  got(path, { ...options }).json();
const doPOSTRequest = (path: string, options?: any) =>
  got.post(path, { ...options }).json();
const doDELETERequest = (path: string, options: any) =>
  got.delete(path, { ...options }).json();
const doPUTRequest = (path: string, options: any) =>
  got.put(path, { ...options }).json();

export const GET = handleAuthAndConfig(doGETRequest);
export const POST = handleAuthAndConfig(doPOSTRequest);
export const PUT = handleAuthAndConfig(doPUTRequest);
export const DELETE = handleAuthAndConfig(doDELETERequest);

export const API: Record<string, DefaultURLPath> = {
  User: () => 'user',
  Organization: (_) => `organizations/${_.organization || ''}`,
  OrganizationPermissions: (_) => `organizations/${_.organization}/permissions`,
  OrganizationBackups: (_) => `organizations/${_.organization}/backups`,
  UpgradeEnvironment: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/upgrade`,
  Environment: (_) =>
    `organizations/${_.organization}/environments/${_.environment || ''}`,
  PopulateDatabase: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/populate-database`,
  ClearDatabase: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/clear-database`,
  SetAdminAccount: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/set-admin-account`,
  Job: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/jobs`,
  TaskStatus: (_) => `service/task-status/${_.task}`,
  Backup: (_) =>
    `organizations/${_.organization}/environments/${_.environment}/backups/${
      _.backup || ''
    }`,
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

export const Region = 'us-east-1';
export type Plan = 'startup' | 'pro' | 'dev' | 'enterprise' | 'staging';
export const DefaultSaleorEndpoint = 'https://vercel.saleor.cloud/graphql/';
