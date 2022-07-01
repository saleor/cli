import chalk from "chalk";
import detectPort from "detect-port";
import { access } from "fs/promises";
import kebabCase from "lodash.kebabcase";
import { customAlphabet } from "nanoid";
import ora from "ora";
import replace from "replace-in-file";
import sanitize from "sanitize-filename";
import { Arguments, CommandBuilder } from "yargs";

import { run } from "../../lib/common.js";
import { downloadFromGitHub } from "../../lib/download.js";
import { API, GET, getEnvironment, POST } from "../../lib/index.js";
import {
  capitalize,
  checkPnpmPresence,
  getSortedServices,
} from "../../lib/util.js";
import { useEnvironment } from "../../middleware/index.js";
import { StoreCreate } from "../../types.js";
import { setupGitRepository } from "../app/create.js";
import { createEnvironment } from "../env/create.js";

export const command = "create [name]";
export const desc = "Boostrap example [name]";

const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

export const builder: CommandBuilder = (_) =>
  _.positional("name", {
    type: "string",
    demandOption: true,
    default: "saleor-demo",
  })
    .option("demo", {
      type: "boolean",
      default: false,
      desc: "specify demo process",
    })
    .option("environment", {
      type: "string",
      desc: "specify environment id",
    });

export const handler = async (argv: Arguments<StoreCreate>): Promise<void> => {
  if (argv.environment) {
    await createStorefront({
      ...argv,
      ...{ environment: argv.environment },
    });

    return;
  }

  if (argv.demo) {
    const project = await createProject(argv);
    const environment = await prepareEnvironment(argv, project);
    await createStorefront({
      ...argv,
      ...{ environment: environment.key },
    });

    return;
  }

  const _argv = await useEnvironment(argv);
  await createStorefront({ ...argv, ..._argv });

  
};

const createProject = async (argv: Arguments<StoreCreate>) => {
  const projects = (await GET(API.Project, argv)) as any[];
  const demoName = capitalize(argv.name || "saleor demo");

  if (projects.filter(({ name }) => name === demoName).length > 0) {
    console.log(
      chalk.green("✔"),
      chalk.bold("Select Project  ·"),
      chalk.cyan(demoName)
    );
    const project = projects.filter(({ name }) => name === demoName)[0];
    return { slug: project.slug };
  }

  const project = (await POST(API.Project, argv, {
    json: {
      name: demoName,
      plan: "dev",
      region: "us-east-1",
    },
  })) as any;

  console.log(
    chalk.green("✔"),
    chalk.bold("Select Project  ·"),
    chalk.cyan(demoName)
  );

  return project;
};

const prepareEnvironment = async (
  argv: Arguments<StoreCreate>,
  project: any
) => {
  const user = (await GET(API.User, argv)) as any;
  const services = (await getSortedServices(argv)) as any[];

  const saleorEnv = await getEnvironment();
  const service =
    saleorEnv === "staging"
      ? services.filter(
          ({ service_type: serviceType }) => serviceType === "SANDBOX"
        )[0]
      : services[0];

  const name = `${project.slug}-${nanoid(8).toLocaleLowerCase()}`;

  console.log(
    chalk.green("✔"),
    chalk.bold("Select the database template ·"),
    chalk.cyan("sample")
  );
  console.log(
    chalk.green("✔"),
    chalk.bold("Select a Saleor version ·"),
    chalk.cyan(
      `Saleor ${service.version} - ${service.display_name} - ${service.service_type}`
    )
  );
  console.log(
    chalk.green("✔"),
    chalk.bold("Environment name ·"),
    chalk.cyan(name)
  );
  console.log(
    chalk.green("✔"),
    chalk.bold("Environment domain ·"),
    chalk.cyan(name)
  );
  console.log(
    chalk.green("✔"),
    chalk.bold("Would you like to enable dashboard access  (y/N) ·"),
    chalk.cyan("yes")
  );
  console.log(
    chalk.green("✔"),
    chalk.bold("Dashboard admin email ·"),
    chalk.cyan(user.email)
  );
  console.log(
    chalk.green("✔"),
    chalk.bold(
      "Would you like to restrict your Environment API with Basic Auth? (y/N) ·"
    ),
    chalk.cyan("no")
  );

  const json = {
    name,
    domain: name,
    email: user.email,
    project: project.slug,
    database: "sample",
    saleor: service.name,
    deploy: false,
    restore: false,
    restore_from: "",
  };

  const environment = await createEnvironment({
    ...argv,
    ...json,
    ...{
      skipRestrict: true,
    },
  });

  return environment;
};

export const createStorefront = async (argv: Arguments<StoreCreate>) => {
  await checkPnpmPresence("react-storefront project");

  const env = (await GET(API.Environment, argv)) as any;

  const spinner = ora("Downloading...").start();
  const target = await getFolderName(sanitize(argv.name));
  await downloadFromGitHub("saleor/react-storefront", target);

  process.chdir(target);
  spinner.text = "Creating .env...";
  const baseURL = `https://${env.domain}/graphql/`;

  await replace.replaceInFile({
    files: ".env",
    from: /NEXT_PUBLIC_API_URI=.*/g,
    to: `NEXT_PUBLIC_API_URI=${baseURL}`,
  });

  await replace.replaceInFile({
    files: "package.json",
    from: /"name": "react-storefront".*/g,
    to: `"name": "${kebabCase(target)}",`,
  });

  await setupGitRepository(spinner);

  spinner.text = "Installing dependencies...";
  await run("pnpm", ["i", "--ignore-scripts"], { cwd: process.cwd() });
  spinner.succeed(chalk.bold("Storefront prepared \n"));
  console.log("-".repeat(process.stdout.columns));
  const detectedPort = await detectPort(3005);
  console.log(
    chalk(
      chalk.bold(
        `\n  Starting server on 0.0.0.0:${detectedPort}, url: http://localhost:${detectedPort}`
      ),
      "\n"
    )
  );

  await run(
    "pnpm",
    ["next", "dev", "--port", detectedPort.toString()],
    { stdio: "inherit", cwd: process.cwd() },
    true
  );
};

const getFolderName = async (name: string): Promise<string> => {
  let folderName = name;
  while (await dirExists(folderName)) {
    folderName = folderName.concat("-0");
  }
  return folderName;
};

const dirExists = async (name: string): Promise<boolean> => {
  try {
    await access(name);
    return true;
  } catch (error) {
    return false;
  }
};
