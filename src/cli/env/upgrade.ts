import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import { API, PUT } from "../../lib/index.js";

type Options = {
  key: string;
};

export const command = "upgrade [key]";
export const desc = "Upgrade a Saleor version in a specific environmet";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { key } = argv;

  const result = await PUT(API.UpgradeEnvironment, { environment_id: key, json: { service: 'saleor-master-staging' }}) as any; 

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};
