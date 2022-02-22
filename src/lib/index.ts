import chalk from "chalk";
import type { CancelableRequest } from "got";
import got from "got";
import Enquirer from 'enquirer';

import Debug from 'debug';
const debug = Debug('lib:index'); // esl

import { Config } from "./config.js";
import { configure } from "../cli/configure.js";

const CloudURL = `https://staging-cloud.saleor.io/api`;

const BaseOptions = {
  prefixUrl: CloudURL,
};

interface PathArgs {
  organization_slug: string
  environment_id?: string
  project_slug?: string
  backup_id?: string
  region_name?: string
}
type DefaultURLPath = (_: PathArgs) => string;

const handleAuthAndConfig = (func: Function) => async (pathFunc: DefaultURLPath, options: any = {}) => {
  let config = await Config.get();

  if (!('token' in config) && !('token' in options)) {
    console.error(chalk.red("Auth token missing"));
    console.error("Please create token and run " + chalk.green("saleor configure"))

    const { runConfig } = await Enquirer.prompt({
      type: 'confirm',
      name: 'runConfig',
      message: 'Would you like to run `saleor configure` now ?'
    }) as { runConfig: boolean}

    if (runConfig) {
      await configure(undefined)
      config = await Config.get();
    } else {
      process.exit(0);
    }
  }

  const {
    token = config.token,
    organization_slug = config.organization_slug || '',
    environment_id = config.environment_id || '',
    project_slug = '',
    backup_id = '',
    region_name = '',
    ...httpOptions
  } = { ...options }

  const path = pathFunc({ environment_id, organization_slug, project_slug, backup_id, region_name });
  debug(path)
  debug('cli options', { environment_id, organization_slug, project_slug, backup_id, region_name })
  debug('`got` options', httpOptions)

  return func(path, { 
    headers: {
      Authorization: `Token ${token}`,
    },
    ...httpOptions
  }) as CancelableRequest;
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
  Organization: _ => `organizations/${_.organization_slug}`,
  OrganizationPermissions: _ => `organizations/${_.organization_slug}/permissions`,
  UpgradeEnvironment: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}/upgrade`,
  Environment: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}`,
  PopulateDatabase: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}/populate-database`,
  ClearDatabase: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}/clear-database`,
  Job: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}/jobs`,
  Backup: _ => `organizations/${_.organization_slug}/environments/${_.environment_id}/backups/${_.backup_id || ''}`,
  Project: _ => `organizations/${_.organization_slug}/projects/${_.project_slug}`,
  Regions: _ =>  "regions",
  Services: _ => `regions/${_.region_name}/services`
}


export const Region = 'us-east-1'
export type Plan = 'startup' | 'pro' | 'dev' | 'enterprise' | 'staging'