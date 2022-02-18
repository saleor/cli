import chalk from "chalk";
import { emphasize } from "emphasize";
import yaml from "yaml";
import type { Arguments, CommandBuilder } from "yargs";
import { API, POST } from "../../lib/index.js";

export const command = "create <name>";
export const desc = "Create a new project";

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new backup'
  })
  .option("plan", { 
    type: 'string',
    desc: 'specify the plan',
    default: 'dev'
  })
  .option("region", { 
    type: 'string',
    desc: 'specify the region',
    default: 'us-east-1'
  })

export const handler = async (argv: Arguments) => {
  const { name, plan, region } = argv;
  const message = `Creating project: ${name}!`;

  console.log(message);
  const result = await POST(API.Project, {
    json: { name, plan, region }
  }) as any;

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};
