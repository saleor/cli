import inquirer from "inquirer";
import { format } from 'date-fns';

import { API, GET } from "../lib/index.js";

export const chooseDefaultEnvironment = async (token: string, organization_slug: string) => {
  const envs = (await GET(API.Environment, { organization_slug, token, environment_id: '' })) as any[];
  if (!envs.length) return;

  const { environment_id } = await inquirer.prompt([
    {
      type: "list",
      name: "environment_id",
      message: "Select the environment:",
      choices: envs.map(_ => ({name: _.name, value: _.key})),
    },
  ]);

  return environment_id;
};

export const chooseOrganization = async (token: string) => {
  const orgs = (await GET(API.Organization, { token })) as any[];
  if (!orgs.length) return;

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