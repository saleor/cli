import { format } from 'date-fns';
import chalk from "chalk";
import Enquirer from "enquirer";

import { API, GET, Region } from "../lib/index.js";

// Higher-Order Creator for Prompts
const createPrompt = async (name: string, message: string, fetcher: any, extractor: any) => {
  const collection = await fetcher();

  if (!collection.length) {
    console.warn(chalk.red(`No ${name}s found`))
    process.exit(0) 
  };

  const choices = collection.map(extractor);

  const { [name]: ret } = await Enquirer.prompt({
    type: 'select',
    name,
    choices,
    message,
  }) as any; 

  // FIXME `enquirer` mutates the object (sic!)
  const result = choices.find((choice: any) => choice.name === ret)

  if (!result) {
    throw Error('something went wrong with prompt')
  }

  return { name: result.name, value: result.value }
}


const SaleorVersionMapper: Record<string, string> = {
  '3.0.0': 'saleor-stable-staging',
  '3.1.0': 'saleor-latest-staging'
}

//
// P U B L I C 
//

export const promptVersion = async (argv: any) => createPrompt(
  'snapshot',
  'Select a Saleor version',
  async () => await GET(API.Services, { ...argv, region: Region }), 
  (_: any) => ({ name: `Saleor ${_.version} - ${_.display_name}`, value: _.name })
)

export const promptDatabaseTemplate = async (argv: any) => createPrompt(
  'database',
  'Select the database template',
  () => (['sample', 'blank', 'snapshot']),
  (_: any) => ({ name: _, value: _ })
)

export const promptProject = (argv: any) => createPrompt(
  'project',
  'Select Project',
  async () => await GET(API.Project, argv),
  (_: any) => ({ name: _.name, value: _.slug })
) 

export const promptEnvironment = async (argv: any) => createPrompt(
  'environment',
  'Select Environment',
  async () => await GET(API.Environment, {...argv, environment: ''}), 
  (_: any) => ({ name: _.name, value: _.key })
);

export const chooseOrganization = async (argv: any) => createPrompt(
  'organization',
  'Select Organization',
  async () => await GET(API.Organization, argv), 
  (_: any) => ({ name: _.name, value: _.slug})
)

export const formatDateTime = (name: string) => format(new Date(name), "yyyy-MM-dd HH:mm")

// TODO check environment presence fn!!!
// TODO check organization presence fn!!!