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
    choices: JSON.parse(JSON.stringify(choices)),
    message,
  }) as any; 

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
  'service',
  'Select a Saleor version',
  async () => await GET(API.Services, { region: Region, ...argv }),
  (_: any) => ({ name: `Saleor ${_.version} - ${_.display_name} - ${_.service_type}`, value: _.name })
)

export const promptVersionToPromote = async (argv: any) => createPrompt(
  'production service',
  'Select a Saleor service',
  async () =>  (await GET(API.Services, { region: Region, ...argv }) as any).filter(({service_type}: any) => service_type === "PRODUCTION"),
  (_: any) => ({ name: `Saleor ${_.version} - ${_.display_name} - ${_.service_type}`, value: _.name })
)

export const promptDatabaseTemplate = async (argv: any) => createPrompt(
  'database',
  'Select the database template',
  () => ([{name: 'sample', value: 'sample'},
          {name: 'blank', value: null},
          {name: 'snapshot', value: null}]),
  (_: any) => ({ name: _.name, value: _.value })
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

export const promptOrganization = async (argv: any) => createPrompt(
  'organization',
  'Select Organization',
  async () => await GET(API.Organization, argv), 
  (_: any) => ({ name: _.name, value: _.slug})
)

export const promptPlan = async (argv: any) => createPrompt(
  'plan',
  'Select Plan',
  async () => await GET(API.Plan, argv),
  (_: any) => ({ name: _.name, value: _.slug})
)

export const promptRegion = async (argv: any) => createPrompt(
  'region',
  'Select Region',
  async () => await GET(API.Region, argv),
  (_: any) => ({ name: _.name, value: _.slug})
)

export const promptOrganizationBackup = async (argv: any) => createPrompt(
  'backup',
  'Select Snapshot',
  async () => await GET(API.OrganizationBackups, argv),
  (_: any) => ({ name: chalk(chalk.bold(_.project.name), chalk(",","ver:", _.saleor_version, ", created on", formatDateTime(_.created), "-"), chalk.bold(_.name)), value: _.key})
)

export const formatDateTime = (name: string) => format(new Date(name), "yyyy-MM-dd HH:mm")

export const printContext = (organization?: string, environment?: string) => {
  let message = `\n ${chalk.bgGray(' CONTEXT ')} `

  if (organization) message += `/ ${chalk.gray('Organization:')} ${organization} `
  if (environment) message += `/ ${chalk.gray('Environment')} ${chalk.underline(environment)}`

  console.log(message + '\n')
}
