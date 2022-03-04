import { format } from 'date-fns';
import _ from "chalk";
import Enquirer from "enquirer";
import ora from 'ora';
import boxen from 'boxen';
import slugify from 'slugify';
import { CliUx } from "@oclif/core";

import { API, GET, POST, Region } from "../lib/index.js";
import { Options } from "../types.js";

const { ux: cli } = CliUx;

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Higher-Order Creator for Prompts
const createPrompt = async (name: string, message: string, fetcher: any, extractor: any, allowCreation: boolean = false) => {
  const collection = await fetcher();

  if (!collection.length && !allowCreation) {
    console.warn(_.red(`No ${name}s found`))
    process.exit(0) 
  };

  const creation = allowCreation ? [{name: "Create new"}] : []
  const choices = [...creation, ...collection.map(extractor)];

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

export const promptCompatibleVersion = async (argv: any, service: string = "SANDBOX" ) => createPrompt(
  'production service',
  'Select a Saleor service',
  async () =>  (await GET(API.Services, { region: Region, ...argv }) as any).filter(({service_type}: any) => service_type === service),
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
  (_: any) => ({ name: _.name, value: _.slug }),
  true
) 

export const promptEnvironment = async (argv: any) => createPrompt(
  'environment',
  'Select Environment',
  async () => await GET(API.Environment, {...argv, environment: ''}), 
  (_: any) => ({ name: _.name, value: _.key }),
  true
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
  (_: any) => ({ name: _.name, value: _.name})
)

export const promptOrganizationBackup = async (argv: any) => createPrompt(
  'backup',
  'Select Snapshot',
  async () => await GET(API.OrganizationBackups, argv),
  (_: any) => ({ name: _(_.bold(_.project.name), _(",","ver:", _.saleor_version, ", created on", formatDateTime(_.created), "-"), _.bold(_.name)), value: _.key})
)

export const formatDateTime = (name: string) => format(new Date(name), "yyyy-MM-dd HH:mm")

export const printContext = (organization?: string, environment?: string) => {
  let message = `\n ${_.bgGray(' CONTEXT ')} `

  if (organization) message += `/ ${_.gray('Organization:')} ${organization} `
  if (environment) message += `/ ${_.gray('Environment')} ${_.underline(environment)}`

  console.log(message + '\n')
}

export const createProject = async (argv: Options) => {
  const { promptName } = await Enquirer.prompt({
    type: 'input',
    name: 'promptName',
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
    const project = await POST(API.Project, argv, {
      json: {
        name: promptName,
        plan: choosenPlan.value,
        region: choosenRegion.value }
    }) as any;

    console.log(_.green("✔"), _.bold("Project has been successfuly created")); 

    return { name: project.slug, value: project.slug }
  }

  process.exit(0)
}

export const createEnvironment = async (argv: Options) => {
  const { environment: base, project, saleor, database } = argv;
  const user = (await GET(API.User, argv)) as any;

  const { name } = await Enquirer.prompt({
    type: 'input',
    name: 'name',
    message: `Environment name`,
    required: true,
  }) as { name: string };

  const { domain } = await Enquirer.prompt({
    type: 'input',
    name: 'domain',
    message: `Environment domain`,
    initial: slugify(name),
    required: true,
  }) as { domain: string };

  
  const { access } = await Enquirer.prompt({
    type: 'confirm',
    name: 'access',
    message: `Would you like to enable dashboard access `,
  }) as { access: boolean };

  let email = null;

  if (access) {
    const { emailPrompt } = await Enquirer.prompt({
      type: 'input',
      name: 'emailPrompt',
      message: `Dashboard admin email`,
      initial: user.email,
      validate: (value) => {
        const re = /\S+@\S+\.\S+/;
        if (!re.test(value)) {
          return _.red(`Please provide valid email`)
        }
        
        return true;
      }
    }) as { emailPrompt: string };

    email = emailPrompt;
  }

  const { restrict } = await Enquirer.prompt({
    type: 'confirm',
    name: 'restrict',
    message: `You can restrict access to your env's API with Basic Auth. Do you want to set it up`,
  }) as { restrict: boolean };

  let login = null;
  let password = null;
 
  if (restrict) {
    const { loginPrompt } = await Enquirer.prompt({
      type: 'input',
      name: 'loginPrompt',
      message: `Login`,
      required: true,
      initial: user.email,
    }) as { loginPrompt: string };

    const { passwordPrompt } = await Enquirer.prompt({
      type: 'password',
      name: 'passwordPrompt',
      message: `Password`,
      required: true,
    }) as { passwordPrompt: string };

    await Enquirer.prompt({
      type: 'password',
      name: 'confirmation',
      message: `Confirm password`,
      required: true,
      validate: (value) => {
        if (value !== passwordPrompt) {
          return _.red(`Passwords must match`)
        }
        return true
      }
    }) as { confirmation: string };

    login = loginPrompt;
    password = passwordPrompt;
  }

  const json = {
    name,
    domain_label: domain,
    email, 
    project,
    database_population: database,
    service: saleor,
    login,
    password,
  }

  const result = await POST(API.Environment, { ...argv, environment: '' }, { json }) as any;

  let currentMsg = 0;
  const messages = [
    `🙌  If you see yourself working on tools like this one, Saleor is looking for great educators and DevRel engineers. Contact us directly at careers@saleor.io or DM on LinkedIn.`,
    `✨ Take your first steps with Saleor's API by checking our tutorial at https://learn.saleor.io`,
    `⚡ If you like React and Next.js, you may want to take a look at our storefront starter pack available at https://github.com/saleor/react-storefront`
  ]

  const spinner = ora('Creating a new environment...').start();
  let succeed = await checkIfJobSucceeded(argv, result.key);

  while(!succeed) {
    await delay(5000)
    spinner.text = `Creating a new environment...

${messages[currentMsg]}`;

    (currentMsg === (messages.length - 1)) ? currentMsg = 0 : currentMsg++;
    succeed = await checkIfJobSucceeded(argv, result.key);
  }

  spinner.succeed(`Yay! A new environment is now ready!
`);

  const accessMsg = `


Please check your email - ${email} - to setup your dashboaard access.`;
  const baseUrl = `https://${result.domain}`;

  console.log(boxen(_.blue(`Dashboard - ${baseUrl}/dashboard


GraphQL Playgroud - ${baseUrl}/graphql/ ${access ? accessMsg : ''}`), {padding: 1}));

  if (access) {
    await GET(API.SetAdminAccount, { ...argv, environment: result.key }) as any;
  }

  const { deployPrompt } = await Enquirer.prompt({
    type: 'confirm',
    name: 'deployPrompt',
    message: `Deploy \`${name}'\ to Vercel`,
  }) as { deployPrompt: boolean };

  if (deployPrompt) {
    await deploy({ name, url: baseUrl })
  }

  return { name, value: name }
}


export const deploy = async ({ name, url }: { name: string, url: string }) => {
  const params = {
    'repository-url': 'https://github.com/saleor/react-storefront',
    'project-name': name || 'my-react-storefront',
    'repository-name': name || 'my-react-storefront',
    'env': 'NEXT_PUBLIC_API_URI,NEXT_PUBLIC_DEFAULT_CHANNEL',
    'envDescription': `'NEXT_PUBLIC_API_URI' is your GraphQL endpoint, while 'NEXT_PUBLIC_DEFAULT_CHANNEL' in most cases should be set to 'default-channel'`,
    'envLink': 'https://github.com/saleor/react-storefront',
  }

  const queryParams = new URLSearchParams(params)

  console.log('');
  console.log(`You will be redirected to Vercel's deployment page to finish the process`);
  console.log(`Use the following ${_.underline('Environment Variables')} for configuration:`);

  console.log(`
${_.gray('NEXT_PUBLIC_API_URI')}=${_.yellow(url)}
${_.gray('NEXT_PUBLIC_DEFAULT_CHANNEL')}=${_.yellow('default-channel')}
  `)

  const { proceed } = (await Enquirer.prompt({
    type: "confirm",
    name: "proceed",
    message: `Do you want to continue?`,
  })) as { proceed: boolean };

  if (proceed) {
    await cli.open(`https://vercel.com/new/clone?${queryParams}`)
  }
}

const checkIfJobSucceeded = async (argv: Options, key: string): Promise<boolean> => {
  const jobs = await GET(API.Job, {...argv, environment: key}) as any[];
  const filtered = jobs.filter(({job_name, status}) => job_name.startsWith('crt') && status === "SUCCEEDED");

  return filtered.length > 0
}