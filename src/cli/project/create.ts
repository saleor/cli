import chalk from "chalk";
import { emphasize } from "emphasize";
import Enquirer from "enquirer";
import yaml from "yaml";
import type { Arguments, CommandBuilder } from "yargs";
import { API, POST } from "../../lib/index.js";
import { promptPlan, promptRegion } from "../../lib/util.js";
import { Options } from "../../types.js";

export const command = "create [name]";
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
    // default: 'dev'
  })
  .option("region", { 
    type: 'string',
    desc: 'specify the region',
    // default: 'us-east-1'
  })

export const handler = async (argv: Arguments<Options>) => {
  const { name, plan, region } = argv;

  const { promptName } = await Enquirer.prompt({
    type: 'input',
    name: 'promptName',
    initial: name,
    message: `Type name`,
  }) as { promptName: string };

  const choosenRegion = await promptRegion(argv);
  const choosenPlan = await promptPlan(argv);

  const { proceed } = await Enquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    message: `You are going to crate project ${promptName}. Continue`,
  }) as { proceed: boolean };

  if (proceed) {
    const result = await POST(API.Project, argv, {
      json: {
        name: promptName,
        plan: choosenPlan.value,
        region: choosenRegion.value }
    }) as any;

    console.log(chalk.green("✔"), chalk.bold("Project has been successfuly created"));
    // console.log("---")
    // console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    //   'attr': chalk.blue
    // }).value);
  }

  process.exit(0);
};
