import { Arguments, CommandBuilder } from "yargs";
import slugify from 'slugify';
import ora from 'ora';

import { interactiveDatabaseTemplate, interactiveProject, interactiveSaleorVersion } from "../../middleware/index.js";
import { API, POST } from "../../lib/index.js";
import Enquirer from "enquirer";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface Options {
  name: string
  project: string
  saleor: string
  database: string
}

export const command = "create [name]";
export const desc = "Create a new environmet";

// TODO environment requires PROJECT !!!!!

export const builder: CommandBuilder = (_) =>
  _.positional("name", { 
    type: "string", 
    demandOption: false,
    desc: 'name for the new environment'
  })
  .option("project", { 
    type: 'string',
    demandOption: false,
    desc: 'create this environment in this project',
  })
  .option("database", { 
    type: 'string',
    desc: 'specify how to populate the database',
  })
  .option("saleor", { 
    type: 'string',
    desc: 'specify the Saleor version',
  })

export const handler = async (argv: Arguments<Options>) => {
  const { name: base, project, saleor, database } = argv;
  const form =  new (Enquirer as any).Form({
    name: 'Type organization details',
    choices: [
      { name: "name", message: "Environment name", initial: base },
      { name: "domain_label", message: "Environment domain", initial: base },
      { name: "admin_email", message: "Superadmin email" },
    ]}
  );

  const formData = await form.run();

  const json = {
    ...formData,
    login: "",
    password: "",
    project,
    database_population: database,
    service: saleor 
  }

  const result = await POST(API.Environment, { ...argv, environment: '' }, { json }) as any;

  // delay(5000);

  const spinner = ora('Creating a new environment...').start();
  setTimeout(() => {
    spinner.color = 'yellow';
    spinner.text = 'Your environment is almost ready...';
  }, 7000);
  setTimeout(() => {
    spinner.succeed('Yay! A new environment is now ready!')
  }, 10000);
};

export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
]