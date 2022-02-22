import { Arguments, CommandBuilder, demandCommand, demandOption } from "yargs";
import { API, GET, POST, Region } from "../../lib/index.js";
import slugify from 'slugify';
import Enquirer from "enquirer";
import chalk from "chalk";
import { getBackups } from "../backup/list.js";

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
    default: 'sample'
  })
  .option("saleor", { 
    type: 'string',
    desc: 'specify the Saleor version',
    default: '3.0.0'
  })

const hash = (name: string) => `${name}-${(Math.random() + 1).toString(36).substring(7)}`;

const SaleorVersionMapper: Record<string, string> = {
  '3.0.0': 'saleor-stable-staging',
  '3.1.0': 'saleor-latest-staging'
}

export const handler = async (argv: Arguments<Options>) => {
  const { name: base, project, saleor, database } = argv;

  const result = await createEnv(base, project, saleor, database);

  console.log(result)

  process.exit(0);
};

export const createEnv = async (base: string, project: string, saleor: string, database: string) => {
  const pickedProject = await chooseProject(project);
  const pickedDatabase = await chooseDatabase(database);
  const pickedVersion = await chooseVersion(saleor);

  // TODO check for backup

  const name = hash(base);
  const message = `Creating: ${name} in the '${pickedProject} project`;
  console.log(message);
  const json = {
    name,
    domain_label: slugify(name),
    admin_email: `${name}@gmail.com`,
    login: "",
    password: "",
    project: pickedProject,
    database_population: pickedDatabase,
    service: pickedVersion
  }

  console.log(json)

  const result = await POST(API.Environment, {
    environment_id: '',
    json
  }) as any;

  // store as default ENV!!!!


  return result
}

const chooseVersion = async (version: string) => {
  // const regions = await GET(API.Regions) as any[];
  const snapshots = await GET(API.Services, { region_name: Region }) as any[];
  const choices = snapshots.map(s => s.name);
  const initial = snapshots.indexOf(version);

  const { pickSnapshot } = await Enquirer.prompt({
    type: 'select',
    name: 'pickSnapshot',
    choices,
    initial: initial,
    message: 'Pick version'
  }) as { pickSnapshot: boolean}

  return pickSnapshot;
}

const chooseDatabase = async (database: string) => {
  const choices = ['sample', 'blank', 'snapshot'];
  const initial = choices.indexOf(database);

  const { pickDatabase } = await Enquirer.prompt({
    type: 'select',
    name: 'pickDatabase',
    choices,
    initial: initial,
    message: 'Pick a database population'
  }) as { pickDatabase: boolean}

  return pickDatabase;
}

const chooseSnapshot = async () => {
  // BACKUPS!!!!
  const backups = await getBackups({})
  const choices = backups.map(b => b.name);

  const { pickBackup } = await Enquirer.prompt({
    type: 'select',
    name: 'pickSnapshot',
    choices,
    message: 'Pick snapshot'
  }) as { pickBackup: boolean}

  return pickBackup;
}

const chooseProject = async (project: string) => {
  const projects = await GET(API.Project) as any[];
  const slugs = projects.map(p => p.slug);

  const initial = slugs.indexOf(project)

  if (!projects.length) {
    console.warn(chalk.red("No projects found"))
    // TODO ask to create project
    return
  };

  const { pickProject } = await Enquirer.prompt({
    type: 'select',
    name: 'pickProject',
    choices: projects.map(p => p.slug),
    initial: initial,
    message: 'Pick a project'
  }) as { pickProject: boolean}

  return pickProject;
}