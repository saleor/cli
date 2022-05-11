import os from "os";
import fs from 'fs-extra';
import path from "path";

const DefaultConfigFile = path.join(os.homedir(), ".config", "saleor.json");

export type ConfigField =
  | "token"
  | "user_session"
  | "id_token"
  | "access_token"
  | "refresh_token"
  | "organization_slug"
  | "organization_name"
  | "environment_id"
  | "vercel_token"
  | "vercel_team_id"
  | "telemetry"
  | "saleor_env"
  | "TunnelServerSecret"
  | "VercelClientID"
  | "VercelClientSecret"

type ConfigProps = Record<ConfigField, string>;

const isEmpty = (object: any) => Object.keys(object).length === 0;

const set = async (field: ConfigField, value: string) => {
  await fs.ensureFile(DefaultConfigFile);
  const content = await fs.readJSON(DefaultConfigFile, { throws: false })

  const new_content = { ...content, [field]: value }
  await fs.outputJSON(DefaultConfigFile, new_content);

  return new_content
}

const remove = async (field: ConfigField) => {
  await fs.ensureFile(DefaultConfigFile);
  const content = await fs.readJSON(DefaultConfigFile, { throws: false }) || {};

  delete content[field];
  await fs.outputJSON(DefaultConfigFile, content);

  return content
}

const get = async (): Promise<ConfigProps> => {
  await fs.ensureFile(DefaultConfigFile);
  const content = await fs.readJSON(DefaultConfigFile, { throws: false })
  return content || {};
}

const reset = async (): Promise<void> => {
  await fs.outputJSON(DefaultConfigFile, {})
}


export const Config = { get, set, reset, remove }