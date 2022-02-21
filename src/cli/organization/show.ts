import type { Arguments, CommandBuilder } from "yargs";
import yaml from "yaml";
import { emphasize } from 'emphasize';
import chalk from 'chalk';

import { API, GET } from "../../lib/index.js";

type Options = {
  slug: string;
};

export const command = "show [slug]";
export const desc = "Show a specific organization";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { slug } = argv;

  const result = await GET(API.Organization, { organization_slug: slug }) as any; 

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};
