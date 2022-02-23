import type { CancelableRequest } from "got";
import got from "got";

import Debug from 'debug';
const debug = Debug('lib:index'); // esl

import { Options } from '../types.js';

const CloudURL = `https://staging-cloud.saleor.io/api`;

const BaseOptions = {
  prefixUrl: CloudURL,
};

interface PathArgs {
  token: string
  organization_slug: string
  environment_id?: string
  project_slug?: string
  backup_id?: string
  region_name?: string
}
type DefaultURLPath = (_: Options) => string;

const handleAuthAndConfig = (func: Function) => async (pathFunc: DefaultURLPath, argv: Options, options: any = {}) => {
  const path = pathFunc(argv);

  debug(path)
  debug('cli options', argv)

  options = { ...options,  
    headers: {
      Authorization: `Token ${argv.token}`,
    }
  }
  debug('`got` options', options)

  return func(path, options) as CancelableRequest;
}

const doGETRequest = (path: string, options?: any) => got(path, {...options, ...BaseOptions}).json();
const doPOSTRequest = (path: string, options?: any) => got.post(path, {...options, ...BaseOptions}).json()
const doDELETERequest = (path: string, options: any) => got.delete(path, {...options, ...BaseOptions}).json();
const doPUTRequest = (path: string, options: any) => got.put(path, {...options, ...BaseOptions}).json();

export const GET = handleAuthAndConfig(doGETRequest);
export const POST =  handleAuthAndConfig(doPOSTRequest);
export const PUT =  handleAuthAndConfig(doPUTRequest);
export const DELETE = handleAuthAndConfig(doDELETERequest);

export const API: Record<string, DefaultURLPath> = {
  User: _ => "user",
  Organization: _ => `organizations/${_.organization || ''}`,
  OrganizationPermissions: _ => `organizations/${_.organization}/permissions`,
  UpgradeEnvironment: _ => `organizations/${_.organization}/environments/${_.environment}/upgrade`,
  Environment: _ => `organizations/${_.organization}/environments/${_.environment || ''}`,
  PopulateDatabase: _ => `organizations/${_.organization}/environments/${_.environment}/populate-database`,
  ClearDatabase: _ => `organizations/${_.organization}/environments/${_.environment}/clear-database`,
  Job: _ => `organizations/${_.organization}/environments/${_.environment}/jobs`,
  Backup: _ => `organizations/${_.organization}/environments/${_.environment}/backups/${_.backup || ''}`,
  Project: _ => `organizations/${_.organization}/projects/${_.project || ''}`,
  Regions: _ =>  "regions",
  Services: _ => `regions/${_.region}/services`
}


export const Region = 'us-east-1'
export type Plan = 'startup' | 'pro' | 'dev' | 'enterprise' | 'staging'