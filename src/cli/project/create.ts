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
  });

export const handler = async (argv: Arguments) => {
  const { name } = argv;
  const message = `Creating project: ${name}!`;

  const result = await POST(API.Backup, {
    json: {
      name: name,
    }
  }) as any;

  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);

  process.exit(0);
};
