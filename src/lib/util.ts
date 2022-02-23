import inquirer from "inquirer";
import { format } from 'date-fns';

import { API, GET } from "../lib/index.js";
import chalk from "chalk";
import Enquirer from "enquirer";

export const promptEnvironment = async (token: string, organization_slug: string) => {
  const envs = (await GET(API.Environment, { organization_slug, token, environment_id: '' })) as any[];
  // if (!envs.length) {
  //   console.warn(chalk.red("No environments found"))
  //   return
  // };

  const choices = envs.map(_ => ({name: _.name, value: _.key}));
  const { environment } = await Enquirer.prompt({
    type: 'select',
    name: 'environment',
    choices,
    initial: 0,
    message: 'Select Environment',
  }) as { environment: string }

  // FIXME `enquirer` mutates the object (sic!)
  const result = choices.find(choice => choice.name === environment)

  if (!result) {
    throw Error('something went wrong with prompt')
  }

  const { name, value } = result;
  return { name, value }
};

export const chooseOrganization = async (token: string) => {
  const orgs = (await GET(API.Organization, { token })) as any[];
  if (!orgs.length) {
    console.warn(chalk.red("No organizations found"))
    return
  };

  const { organization_slug } = await inquirer.prompt([
    {
      type: "list",
      name: "organization_slug",
      message: "Choose organization:",
      choices: orgs.map((org) => ({name: org.name, value: org.slug})),
    },
  ]);

  return organization_slug;
};

export const formatDateTime = (name: string) => format(new Date(name), "yyyy-MM-dd HH:mm")


// TODO check environment presence fn!!!
// TODO check organization presence fn!!!