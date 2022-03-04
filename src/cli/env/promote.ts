import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import { API, PUT, GET } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptCompatibleVersion } from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";

export const command = "promote [environment]";
export const desc = "Promote environment to produciton";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const env  = await GET(API.Environment, argv) as any;
  const service = await promptCompatibleVersion(
    {...argv,
      region: env.service.region,
      serviceName: `?compatible_with=${env.service.version}`
    },
    "PRODUCTION");
  const result = await PUT(API.UpgradeEnvironment, argv, { json: { service: service.value }}) as any; 

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};

export const middlewares = [
  useEnvironment
]
