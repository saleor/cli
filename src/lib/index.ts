import type { CancelableRequest } from "got";
import got from "got";
import { Config } from "./config.js";

const CloudURL = `https://staging-cloud.saleor.io/api`;

const BaseOptions = {
  prefixUrl: CloudURL,
};

const handleAuthAndConfig = (func: Function) => async (path: string, options: any = {}) => {
  const config = await Config.get();
  
  const { token = config.token, ...httpOptions } = { ...options }

  if (!token) {
    console.error("Missing the auth token: Please create token and run `saleor configure`");
    throw Error("No auth token")
  }

  return func(path, { 
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
  User: () => "user",
  Organization: (organization_slug: string = '') => `organizations/${organization_slug}`,
  Environment: (organization_slug: string, environment_slug: string = '') => `organizations/${organization_slug}/environments/${environment_slug}`,
  PopulateDatabase: (organization_slug: string, environment_slug: string = '') => `organizations/${organization_slug}/environments/${environment_slug}/populate-database`,
  ClearDatabase: (organization_slug: string, environment_slug: string = '') => `organizations/${organization_slug}/environments/${environment_slug}/clear-database`,
  Job: (organization_slug: string, environment_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/jobs`,
  Backup: (organization_slug: string, environment_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/backups`,
  Project: (organization_slug: string, project_slug: string = '') => `organizations/${organization_slug}/projects/${project_slug}`,
}
