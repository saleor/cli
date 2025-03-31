import os from 'os';
import path from 'path';
import fs from 'fs-extra';

const DefaultConfigFile = path.join(os.homedir(), '.config', 'saleor.json');

export const SaleorCLIPort = 5375;

export type ConfigField =
  | 'token'
  | 'user_session'
  | 'id_token'
  | 'access_token'
  | 'refresh_token'
  | 'organization_slug'
  | 'organization_name'
  | 'environment_id'
  | 'vercel_token'
  | 'vercel_team_id'
  | 'saleor_env'
  | 'cloud_api_url'
  | 'cloud_api_auth_domain'
  | 'TunnelServerSecret'
  | 'VercelClientID'
  | 'VercelClientSecret'
  | 'SentryDSN'
  | 'GithubClientID'
  | 'github_token'
  | 'lastUpdateCheck';

type CacheItem = Record<string, string[]>;

type ConfigProps = Record<ConfigField, string> & Record<'cache', CacheItem>;

const set = async (field: ConfigField, value: string) => {
  await fs.ensureFile(DefaultConfigFile);
  const content = await fs.readJSON(DefaultConfigFile, { throws: false });

  const newContent = { ...content, [field]: value };
  await fs.outputJSON(DefaultConfigFile, newContent, { spaces: '\t' });

  return newContent;
};

const remove = async (field: ConfigField) => {
  await fs.ensureFile(DefaultConfigFile);
  const content =
    (await fs.readJSON(DefaultConfigFile, { throws: false })) || {};

  delete content[field];
  await fs.outputJSON(DefaultConfigFile, content, { spaces: '\t' });

  return content;
};

const get = async (): Promise<ConfigProps> => {
  await fs.ensureFile(DefaultConfigFile);
  const content = await fs.readJSON(DefaultConfigFile, { throws: false });
  return content || {};
};

const reset = async (): Promise<void> => {
  await fs.outputJSON(DefaultConfigFile, {});
};

const getBearerHeader = async (): Promise<Record<string, string>> => {
  const { token } = await get();

  if (token) {
    return { 'Authorization-Bearer': token.split(' ').slice(-1)[0] };
  }

  throw new Error('\nYou are not logged in\n');
};

const appendCache = async (key: string, value: string) => {
  const content = await get();
  const cache = content.cache || {};

  cache[key] = [...(cache[key] || []), value];

  const newContent = { ...content, cache };
  await fs.outputJSON(DefaultConfigFile, newContent, { spaces: '\t' });

  return newContent;
};

export const Config = { get, set, appendCache, reset, remove, getBearerHeader };
