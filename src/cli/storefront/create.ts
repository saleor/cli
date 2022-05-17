import { Arguments, CommandBuilder } from "yargs";
import ora from "ora";
import { access } from 'fs/promises';
import replace from "replace-in-file";
import sanitize from "sanitize-filename";

import { API, GET, POST, getEnvironment } from "../../lib/index.js";
import { StoreCreate } from "../../types.js";
import { run } from "../../lib/common.js";
import { capitalize, checkPnpmPresence, getSortedServices } from "../../lib/util.js";
import { createEnvironment } from "../env/create.js";
import { useEnvironment } from "../../middleware/index.js";
import chalk from "chalk";
import { customAlphabet } from "nanoid";
import { downloadFromGitHub } from "../../lib/download.js";


export const command = "create [name]";
export const desc = "Boostrap example [name]";

const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10)

export const builder: CommandBuilder = (_) =>
  _.positional("name", { type: "string", demandOption: true, default: "saleor-demo" })
    .option("demo", {
      type: 'boolean',
      default: false,
      desc: 'specify demo process',
    })
    .option("environment", {
      type: 'string',
      desc: 'specify environment id',
    })

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  if (argv.environment) {
    return await createStorefront({ ...argv, ...{ environment: argv.environment } })
  }

  if (argv.demo) {
    const project = await createProject(argv)
    const environment = await prepareEnvironment(argv, project)
    return await createStorefront({ ...argv, ...{ environment: environment.key } })
  }

  const _argv = await useEnvironment(argv)
  await createStorefront({ ...argv, ..._argv })
}

const createProject = async (argv: Arguments<StoreCreate>) => {
  const projects = await GET(API.Project, argv) as any[];
  const demoName = capitalize(argv.name || "saleor demo")

  if (projects.filter(({ name }) => name === demoName).length > 0) {
    console.log(chalk.green("✔"), chalk.bold("Select Project  ·"), chalk.cyan(demoName));
    const project = projects.filter(({ name }) => name === demoName)[0]
    return { slug: project.slug }
  }

  const project = await POST(API.Project, argv, {
    json: {
      name: demoName,
      plan: 'dev',
      region: 'us-east-1'
    }
  }) as any;

  console.log(chalk.green("✔"), chalk.bold("Select Project  ·"), chalk.cyan(demoName));

  return project
}

const prepareEnvironment = async (argv: Arguments<StoreCreate>, project: any) => {
  const user = (await GET(API.User, argv)) as any;
  const services = (await getSortedServices(argv)) as any[];

  const saleorEnv = await getEnvironment();
  const service = (saleorEnv === 'staging') ?
    services.filter(({ service_type }) => service_type === "SANDBOX")[0] :
    services[0];

  const name = `${project.slug}-${nanoid(8).toLocaleLowerCase()}`;

  console.log(chalk.green("✔"), chalk.bold("Select the database template ·"), chalk.cyan('sample'));
  console.log(chalk.green("✔"), chalk.bold("Select a Saleor version ·"), chalk.cyan(`Saleor ${service.version} - ${service.display_name} - ${service.service_type}`));
  console.log(chalk.green("✔"), chalk.bold("Environment name ·"), chalk.cyan(name));
  console.log(chalk.green("✔"), chalk.bold("Environment domain ·"), chalk.cyan(name));
  console.log(chalk.green("✔"), chalk.bold("Would you like to enable dashboard access  (y/N) ·"), chalk.cyan('true'));
  console.log(chalk.green("✔"), chalk.bold("Dashboard admin email ·"), chalk.cyan(user.email));
  console.log(chalk.green("✔"), chalk.bold("You can restrict access to your env API with Basic Auth. Do you want to set it up (y/N) ·"), chalk.cyan('false'));

  const json = {
    name,
    domain: name,
    email: user.email,
    project: project.slug,
    database: 'sample',
    saleor: service.name,
    deploy: false,
    restore: false,
    restore_from: ''
  }

  const environment = await createEnvironment({
    ...argv,
    ...json,
    ...{
      skipRestrict: true
    }
  });

  return environment
}

export const createStorefront = async (argv: Arguments<StoreCreate>) => {
  await checkPnpmPresence();

  const env = await GET(API.Environment, argv) as any;

  const spinner = ora('Downloading...').start();
  const target = await getFolderName(sanitize(argv.name));
  const file = await downloadFromGitHub(`saleor/react-storefront`, target);

  process.chdir(target);
  spinner.text = `Creating .env...`;
  const baseURL = `https://${env.domain}/graphql/`;

  replace.sync({
    files: '.env',
    from: /NEXT_PUBLIC_API_URI=.*/g,
    to: `NEXT_PUBLIC_API_URI=${baseURL}`
  });

  spinner.text = 'Installing dependencies...';
  await run('pnpm', ['i', '--ignore-scripts'], { cwd: process.cwd() });
  spinner.succeed(chalk.bold('Storefront prepared \n'));
  console.log('-'.repeat(process.stdout.columns));
  console.log(chalk(chalk.bold('\n  Starting server on 0.0.0.0:3005, url: http://localhost:3005'), '\n'));

  await run('pnpm', ['next', 'dev', '--port', '3005'], { stdio: 'inherit', cwd: process.cwd() }, true);
}

const getFolderName = async (name: string): Promise<string> => {
  let folderName = name;
  while (await dirExists(folderName)) {
    folderName = folderName.concat('-0');
  }
  return folderName
}

const dirExists = async (name: string): Promise<boolean> => {
  try {
    await access(name);
    return true
  } catch (error) {
    return false
  }
}