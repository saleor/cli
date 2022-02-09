import got from "got";
import path from 'path';
import fs from 'fs/promises'

const CloudURL = `https://staging-cloud.saleor.io/api`;

const BaseOptions = {
  prefixUrl: CloudURL,
};

export const GET = (path: string, options: any) => got(path, {...options, ...BaseOptions}).json();

export const API = {
  User: "user/",
  Organization: (organization_slug: string = '') => `organizations/${organization_slug}`,
  Environment: (organization_slug: string, environment_slug: string = '') => `organizations/${organization_slug}/environments/${environment_slug}`,
  Job: (organization_slug: string, environment_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/jobs`,
  Backup: (organization_slug: string, environment_slug: string) => `organizations/${organization_slug}/environments/${environment_slug}/backups`,
  Project: (organization_slug: string, project_slug: string = '') => `organizations/${organization_slug}/projects/${project_slug}`,
}

export const getCurrentToken = async () => {
  const content = await fs.readFile(path.join(process.cwd(), 'token.txt'), 'utf-8');
  return content; 
}

