import { format } from 'date-fns';
import chalk from "chalk";
import Enquirer from "enquirer";
import got from 'got';
import ora from 'ora';
import { emphasize } from 'emphasize';
import yaml from "yaml";

import { API, GET, POST, Region } from "../lib/index.js";
import { Options } from "../types.js";
import { SaleorAppByID } from '../graphql/SaleorAppByID.js';

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// Higher-Order Creator for Prompts
const createPrompt = async (name: string, message: string, fetcher: any, extractor: any, allowCreation: boolean = false) => {
  const collection = await fetcher();

  if (!collection.length && !allowCreation) {
    console.warn(chalk.red(`No ${name}s found`))
    process.exit(0)
  };

  const creation = allowCreation ? [{name: "Create new"}] : []
  const choices = [...creation, ...collection.map(extractor)];

  const r = await Enquirer.prompt({
    type: 'select',
    name,
    choices: JSON.parse(JSON.stringify(choices)),
    message,
  }) as any;

  const { [name]: ret } = r;


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

const doRefreshToken = `
mutation refreshTokenWithUser($csrfToken: String!, $refreshToken: String!) {
  tokenRefresh(csrfToken: $csrfToken, refreshToken: $refreshToken) {
    token
  }
}
`

export const makeRequestRefreshToken = async (domain: string, argv: any) => {
  const { csrfToken, refreshToken } = argv;

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    json: {
      query: doRefreshToken,
      variables: { csrfToken, refreshToken }
    }
  }).json()

  if (errors) {
    throw new AuthError("cannot refresh the token")
  }

  const { tokenRefresh: { token } } = data;

  if (!token) {
    throw new AuthError("cannot auth")
  }

  return token
}

const AppList = `
query AppsList {
  apps(first: 100) {
    totalCount
    edges {
      node {
        id
        name
        isActive
        type
        webhooks {
          id
          name
          targetUrl
        }
      }
    }
  }
}
`

export const makeRequestAppList = async (argv: any) => {
  const { domain } = (await GET(API.Environment, argv)) as any;

  const token = await makeRequestRefreshToken(domain, argv);
  const { data, errors }: any = await got
    .post(`https://${domain}/graphql`, {
      headers: {
        "authorization-bearer": token,
        "content-type": "application/json",
      },
      json: { query: AppList },
    })
    .json();

  if (errors) {
    throw new AuthError("cannot auth")
  }

  return data.apps.edges;
};

//
// P U B L I C
//

export const promptWebhook = async (argv: any) => createPrompt(
  'webhookID',
  'Select a Webhook',
  async () => {
    const { domain } = (await GET(API.Environment, argv)) as any;
    const token = await makeRequestRefreshToken(domain, argv);

    const { app: appID } = argv;

    const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
      headers: {
        'authorization-bearer': token,
        'content-type': 'application/json',
      },
      json: {
        query: SaleorAppByID,
        variables: { appID }
      }
    }).json()

    if (errors) {
      throw Error("cannot auth")
    }

    const { app: { name, webhooks } } = data;

    return webhooks;
  },
  ({ id, name, targetUrl }: any) => ({ name: `${name} (${targetUrl})`, value: id })
)

export const promptSaleorApp = async (argv: any) => createPrompt(
  'app',
  'Select a Saleor App',
  async () => {
    const collection = await makeRequestAppList(argv);
    return collection;
  },
  ({ node: { name, id } }: any) => ({ name, value: id })
)


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
  (_: any) => ({ name: chalk(chalk.bold(_.project.name), chalk(",","ver:", _.saleor_version, ", created on", formatDateTime(_.created), "-"), chalk.bold(_.name)), value: _.key})
)

export const formatDateTime = (name: string) => format(new Date(name), "yyyy-MM-dd HH:mm")

export const printContext = (organization?: string, environment?: string) => {
  let message = `\n ${chalk.bgGray(' CONTEXT ')}\n`

  if (organization) message += ` ${chalk.gray('Organization')} ${organization} `
  if (environment) message += `- ${chalk.gray('Environment')} ${chalk.underline(environment)}`

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

    console.log(chalk.green("✔"), chalk.bold("Project has been successfuly created"));

    return { name: project.slug, value: project.slug }
  }

  process.exit(0)
}

export const validateLength = (value: string, maxLength: number): boolean | string => {
  if (value.length > maxLength) {
    return chalk.red(`Please use ${maxLength} characters maximum`)
  }

  return true;
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
  console.log(`Use the following ${chalk.underline('Environment Variables')} for configuration:`);

  console.log(`
${chalk.gray('NEXT_PUBLIC_API_URI')}=${chalk.yellow(url)}
${chalk.gray('NEXT_PUBLIC_DEFAULT_CHANNEL')}=${chalk.yellow('default-channel')}
  `)

  console.log(`To complete the deployment, open the following link in your browser and continue there:`);
  console.log(`
https://vercel.com/new/clone?${queryParams}`);
}

export const checkIfJobSucceeded = async (taskId: string): Promise<boolean> => {
  const result = await GET(API.TaskStatus, {task: taskId}) as any;
  return result.status === "SUCCEEDED";
}

export const waitForTask = async (argv: Options, taskId: string, spinnerText: string, spinnerSucceed: string) => {
  let currentMsg = 0;
  const messages = [
    `🙌  If you see yourself working on tools like this one, Saleor is looking for great educators and DevRel engineers.
      Contact us directly at careers@saleor.io or DM on LinkedIn.`,
    `✨ Take your first steps with Saleor's API by checking our tutorial at https://learn.saleor.io`,
    `⚡ If you like React and Next.js, you may want to take a look at our storefront starter pack available at https://github.com/saleor/react-storefront`
  ]

  const spinner = ora(`${spinnerText}...`).start();
  let succeed = await checkIfJobSucceeded(taskId);

  while (!succeed) {
    await delay(10000)
    spinner.text = `${spinnerText}...

  ${messages[currentMsg]}`;

    if (currentMsg === (messages.length - 1)) {
      currentMsg = 0;
    } else {
      currentMsg++
    }

    succeed = await checkIfJobSucceeded(taskId);
  }

  spinner.succeed(`${spinnerSucceed}
  `);
}

export const showResult = (result: {}) => {
  console.log("---")
  console.log(emphasize.highlight("yaml", yaml.stringify(result), {
    'attr': chalk.blue
  }).value);
}