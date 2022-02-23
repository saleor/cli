import { Arguments, CommandBuilder } from "yargs";
import slugify from 'slugify';

import { API, POST } from "../../lib/index.js";
import { interactiveDatabaseTemplate, interactiveProject, interactiveSaleorVersion } from "../../middleware/index.js";

interface Options {
  name: string
  project: string
  saleor: string
  database: string
}

export const command = "create <name>";
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

const hash = (name: string) => `${name}-${(Math.random() + 1).toString(36).substring(7)}`;

export const handler = async (argv: Arguments<Options>) => {
  const { name: base, project, saleor, database } = argv;

  // TODO check for backup

  const name = hash(base);
  const message = `Creating: ${name} in the '${project} project`;
  console.log(message);
  const json = {
    name,
    domain_label: slugify(name),
    admin_email: `${name}@gmail.com`,
    login: "",
    password: "",
    project,
    database_population: database,
    service: saleor 
  }

  console.log(json)
  // const result = await POST(API.Environment, { ...argv, environment: '' }, json) as any;

  // store as default ENV!!!!
};


// const chooseSnapshot = async () => {
//   // BACKUPS!!!!
//   const backups = await getBackups({})
//   const choices = backups.map(b => b.name);

//   const { pickBackup } = await Enquirer.prompt({
//     type: 'select',
//     name: 'pickSnapshot',
//     choices,
//     message: 'Pick snapshot'
//   }) as { pickBackup: boolean}

//   return pickBackup;
// }

export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
]