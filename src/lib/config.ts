import os from "os";
import fs from 'fs-extra';
import path from "path";

const DEFAULT_CONFIG_FILE = path.join(os.homedir(), ".config", "saleor.json");

type ConfigProps = {
  token?: string;
  organization?: string;
}

const set = async (config: ConfigProps, configFile: string = DEFAULT_CONFIG_FILE) => {
  const configDir = path.dirname(configFile);

  const consgiDirExists = await fs.pathExists(configDir);
  if (!consgiDirExists) {
    await fs.mkdir(configDir);
  }

  await fs.writeFile(configFile, JSON.stringify(config));
}

const get = async (configFile: string = DEFAULT_CONFIG_FILE): Promise<ConfigProps> => {
  const r = await fs.pathExists(configFile);

  if (r) {
    const content = await fs.readFile(configFile, "utf-8");
    const { token } = JSON.parse(content);

    return { token }
  } else {
    return {}
  }
}

export const Config = { get, set }