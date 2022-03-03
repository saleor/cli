import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import { API, GET, PUT } from "../../lib/index.js";
import { Options } from "../../types.js";
import { promptCompatibleVersion } from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";

export const command = "upgrade [environment]";
export const desc = "Upgrade a Saleor version in a specific environment";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const env  = await GET(API.Environment, argv) as any;
  const service = await promptCompatibleVersion({
    ...argv,
    region: env.service.region,
    serviceName: `?compatible_with=${env.service.version}`
  });
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
