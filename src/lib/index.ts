import type { CancelableRequest } from "got";
import got from "got";
import { Config } from "./config.js";

const CloudURL = `https://staging-cloud.saleor.io/api`;

const BaseOptions = {
  prefixUrl: CloudURL,
};

type OrganizationPath = (organization_slug: string) => string;

const handleAuthAndConfig = (func: Function) => async (path: OrganizationPath, options: any = {}) => {
  const config = await Config.get();
  
  const {
    token = config.token,
    organization_slug = config.organization_slug || '',
    ...httpOptions
  } = { ...options }

  if (!token) {
    console.error("Missing the auth token: Please create token and run `saleor configure`");
    throw Error("No auth token")
  }

  const pathA = path(organization_slug)
  console.log(pathA);

  return func(pathA, { 
    headers: {
      Authorization: `Token ${token}`,
    },
    ...httpOptions
  }) as CancelableRequest;
}

const doGETRequest = (path: string, options?: any) => got(path, {...options, ...BaseOptions}).json();
const doPOSTRequest = (path: string, options?: any) => got.post(path, {...options, ...BaseOptions}).json()
const doDELETERequst = (path: string, options: any) => got.delete(path, {...options, ...BaseOptions}).json();

export const GET = handleAuthAndConfig(doGETRequest);
export const POST =  handleAuthAndConfig(doPOSTRequest);
export const DELETE = handleAuthAndConfig(doDELETERequst);

export const API = {
  User: () => (organization_slug: string) => "user",
  Organization: () => (organization_slug: string) => `organizations/${organization_slug}`,
  Environment: (environment_slug: string = '') => (organization_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}`,
  PopulateDatabase: (environment_slug: string = '') => (organization_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/populate-database`,
  ClearDatabase: (environment_slug: string = '') => (organization_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/clear-database`,
  Job: (environment_slug: string) => (organization_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/jobs`,
  Backup: (environment_slug: string) => (organization_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/backups`,
  Project: (project_slug: string = '') => (organization_slug: string) => `organizations/${organization_slug}/projects/${project_slug}`,
}
