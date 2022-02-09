import * as fs from 'fs'
import * as path from "path";

const DEFAULT_CONFIG_FILE = ".saleor/config.json"

interface SaleorConfigProps {
  token: string | null;
}

class SaleorConfig {
  configFile: string;
  token: string | null;

  constructor(configFile?: string) {
    this.configFile = configFile || DEFAULT_CONFIG_FILE;
    this.token = null;

    if (this.exists()) {
      this.read();
    }
  }

  exists(): boolean {
    return fs.existsSync(this.configFile);
  }

  read() {
    const content = fs.readFileSync(this.configFile, 'utf-8');
    this.load(JSON.parse(content));
  }

  write() {
    fs.mkdirSync(path.dirname(this.configFile));
    fs.writeFileSync(this.configFile, JSON.stringify(this.dump()));
  }

  load(dump: SaleorConfigProps) {
    this.token = dump.token || null;
  }

  dump(): SaleorConfigProps {
    return {
      token: this.token,
    };
  }

  setToken(token: string) {
    this.token = token;
    this.write();
  }
}

export default SaleorConfig;
