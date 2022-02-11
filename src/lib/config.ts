import fs from 'fs-extra'
import path from "path";

const DEFAULT_CONFIG_FILE = ".saleor/config.json"

let configFile: string;

const setToken = async (token: string) => {
  await fs.mkdir(path.dirname(configFile));
  await fs.writeFile(configFile, JSON.stringify({ token }));
}

const init = async (configFile?: string) => {
  configFile = configFile || DEFAULT_CONFIG_FILE;

  const r = await fs.pathExists(configFile);

  if (r) {
    const content = await fs.readFile(configFile, "utf-8");
    const { token } = JSON.parse(content);

    return { token }
  } else {
    return {}
  }
}

export const Config = { init, setToken }