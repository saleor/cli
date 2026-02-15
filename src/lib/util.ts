/* eslint-disable max-classes-per-file */
import chalk from 'chalk';
import { format } from 'date-fns';
import { emphasize } from 'emphasize';
import Enquirer from 'enquirer';
import got from 'got';
import { print as gqlPrint } from 'graphql';
import logSymbols from 'log-symbols';
import { lookpath } from 'lookpath';
import open from 'open';
import ora from 'ora';
import yaml from 'yaml';
import { Arguments } from 'yargs';

import { GetAppById, GetApps } from '../generated/graphql.js';
import { API, DefaultRegion, GET, POST } from '../lib/index.js';
import {
  Backup,
  BaseOptions,
  Environment,
  Options,
  Organization,
  Plan,
  Project,
  ProjectCreate,
  Region,
  Webhook,
} from '../types.js';
import { Config } from './config.js';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return
export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
export const uncapitalize = (value: string) =>
  value.charAt(0).toLowerCase() + value.slice(1);

interface ResultFormat {
  json?: boolean;
}

export const ClientErrorCollection = [
  'NotSaleorAppDirectoryError',
  'CannotOpenURLError',
  'AuthError',
  'NgrokError',
  'NotSaleorAppDirectoryError',
  'SaleorAppInstallError',
  'SaleorAppUninstallError',
  'GitError',
  'WrongGitURLError',
  'CommandRemovedError',
];

export class SaleorEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaleorEventError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class NotSaleorAppDirectoryError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'NotSaleorAppDirectoryError';
  }
}

export class NgrokError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'NgrokError';
  }
}

export class CannotOpenURLError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'CannotOpenURLError';
  }
}

export class SaleorAppUninstallError extends Error {
  constructor(message = 'There is no Saleor App with the provided ID') {
    super(message);
    this.name = 'SaleorAppUninstallError';
  }
}

export class GitError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'GitError';
  }
}

export class SaleorEnvironmentError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'SaleorEnvironmentError';
  }
}

export class SaleorOrganizationError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'SaleorOrganizationError';
  }
}

export class SaleorAppError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'SaleorAppError';
  }
}

export class WrongGitURLError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'WrongGitURLError';
  }
}

export class SaleorAppInstallError extends Error {
  constructor(
    message = 'Cannot install this Saleor App. Check your connection and try again.',
  ) {
    super(message);
    this.name = 'SaleorAppInstallError';
  }
}

export class NameMismatchError extends Error {
  constructor(message = '') {
    super(message);
    this.name = 'NameMismatchError';
  }
}

export class CommandRemovedError extends Error {
  constructor(message = 'This command has been removed') {
    super(message);
    this.name = 'CommandRemovedError';
  }
}

export const fetchLatestPackageVersion = async (name: string) => {
  const { version } = await got
    .get(`https://registry.npmjs.org/${name}/latest`)
    .json<{ version: string }>();
  return version;
};

// Higher-Order Creator for Prompts
const createPrompt = async <T>({
  name,
  message,
  fetcher,
  extractor,
  allowCreation = false,
  json,
}: {
  name: string;
  message: string;
  fetcher: () => Promise<T[]> | T[];
  extractor: (item: T) => { name: string; value: string; hint?: string };
  allowCreation?: boolean;
  json?: boolean;
}) => {
  const collection = await fetcher();

  verifyResultLength(collection, name, json);

  const creation = allowCreation ? [{ name: 'Create new', value: '' }] : [];
  const choices = [...creation, ...collection.map(extractor)];

  const r = (await Enquirer.prompt({
    type: 'select',
    name,
    choices: JSON.parse(JSON.stringify(choices)),
    message,
    skip: !allowCreation && collection.length === 1,
  })) as any;

  const { [name]: ret } = r;
  const result = choices.find((choice) => choice.name === ret);
  if (!result) {
    throw Error('something went wrong with prompt');
  }

  return { name: result.name, value: result.value };
};

export const makeRequestAppList = async (argv: Options) => {
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(argv.instance, {
      headers,
      json: { query: gqlPrint(GetApps) },
    })
    .json();

  if (errors) {
    throw new AuthError('cannot auth');
  }

  return data.apps.edges;
};

//
// P U B L I C
//

export const print = process.stdout.write.bind(process.stdout);
export const println = console.log.bind(console);

export const printlnSuccess = (msg: string) =>
  println(chalk.green(logSymbols.success), msg);

export const obfuscate = (value: string) => `${value.slice(0, 12)} ****`;
export const obfuscateArgv = (argv: Arguments<BaseOptions>) => {
  // immutable
  // structuredClone, available from Node.js 17
  const argvCopy = Object.fromEntries(Object.entries(argv));

  if (argv.token) {
    argvCopy.token = obfuscate(argv.token);
  }

  return argvCopy;
};

export const checkPnpmPresence = async (entity: string) => {
  const pnpm = await lookpath('pnpm');
  if (!pnpm) {
    console.log(
      chalk.red(`
✘ ${entity} uses the pnpm package manager. To install it, run:`),
    );
    console.log('  npm install -g pnpm');
    process.exit(1);
  }
};

export const promptWebhook = async (argv: Options) =>
  createPrompt({
    name: 'webhookID',
    message: 'Select a Webhook',
    fetcher: async () => {
      const headers = await Config.getBearerHeader();
      const { app: appID, instance } = argv;

      const { data, errors }: any = await got
        .post(instance, {
          headers,
          json: {
            query: gqlPrint(GetAppById),
            variables: { appID },
          },
        })
        .json();

      if (errors) {
        throw Error('cannot auth');
      }

      const {
        app: { webhooks },
      } = data;

      return webhooks;
    },
    extractor: ({ name, id, targetUrl }: Webhook) => ({
      name: `${name} (${targetUrl})`,
      value: id,
    }),
    json: argv.json,
  });

export const promptSaleorApp = async (argv: Options) =>
  createPrompt({
    name: 'app',
    message: 'Select a Saleor App',
    fetcher: async () => {
      const collection = await makeRequestAppList(argv);
      return collection;
    },
    extractor: ({ node: { name, id } }: any) => ({ name, value: id }),
    json: argv.json,
  });

export const getSortedServices = async ({
  region = DefaultRegion,
  serviceName = undefined,
  token,
}: {
  region?: string;
  serviceName?: string;
  token: string;
}) => {
  const services = (await GET(API.Services, {
    region,
    serviceName,
    token,
  })) as Record<string, any>[];

  return services.sort((a, b) => b.version.localeCompare(a.version));
};

export const promptCompatibleVersion = async ({
  region = DefaultRegion,
  serviceName = undefined,
  service = 'SANDBOX',
  json = false,
  token,
}: {
  region: string;
  serviceName?: string;
  service?: string;
  json?: boolean;
  token?: string;
}) =>
  createPrompt({
    name: 'production service',
    message: 'Select a Saleor service',
    fetcher: async () =>
      (await getSortedServices({ region, serviceName, token: token || '' }))
        .filter(({ service_type: serviceType }: any) => serviceType === service)
        .sort((a, b) =>
          b.version
            .replace(/\d+/g, (n: string) => +n + 100000)
            .localeCompare(
              a.version.replace(/\d+/g, (n: string) => +n + 100000),
            ),
        ),
    extractor: (_: any) => ({
      name: `Saleor ${_.version} - ${_.display_name}`,
      value: _.name,
    }),
    json,
  });

export const promptDatabaseTemplate = async () =>
  createPrompt({
    name: 'database',
    message: 'Select the database template',
    fetcher: () => [
      {
        name: 'sample',
        value: 'sample',
        hint: 'Includes a sample product catalog and basic configuration',
      },
      {
        name: 'blank',
        value: '',
        hint: 'Contains no data and configuration settings',
      },
      {
        name: 'snapshot',
        value: '',
        hint: 'Import data from backups or your own snapshots',
      },
    ],
    extractor: (_: { name: string; value: string; hint: string }) => ({
      name: _.name,
      value: _.value,
      hint: _.hint,
    }),
    json: false,
  });

export const promptProject = (argv: Options) =>
  createPrompt({
    name: 'project',
    message: 'Select Project',
    fetcher: async () => GET(API.Project, argv) as Promise<Project[]>,
    extractor: (_: Project) => ({ name: _.name, value: _.slug }),
    allowCreation: true,
    json: argv.json,
  });

export const promptEnvironment = async (argv: Options) =>
  createPrompt({
    name: 'environment',
    message: 'Select Environment',
    fetcher: async () =>
      GET(API.Environment, { ...argv, environment: '' }) as Promise<
        Environment[]
      >,
    extractor: (_: Environment) => ({ name: _.name, value: _.key }),
    allowCreation: false,
    json: argv.json,
  });

export const promptOrganization = async (argv: Options) =>
  createPrompt({
    name: 'organization',
    message: 'Select Organization',
    fetcher: async () => GET(API.Organization, argv) as Promise<Organization[]>,
    extractor: (_: Organization) => ({ name: _.name, value: _.slug }),
    json: argv.json,
  });

export const promptPlan = async (argv: any) =>
  createPrompt({
    name: 'plan',
    message: 'Select Plan',
    fetcher: async () => GET(API.Plan, argv) as Promise<Plan[]>,
    extractor: (_: Plan) => ({ name: _.name, value: _.slug }),
    json: argv.json,
  });

export const promptRegion = async (argv: any) =>
  createPrompt({
    name: 'region',
    message: 'Select Region',
    fetcher: async () => GET(API.Region, argv) as Promise<Region[]>,
    extractor: (_: Region) => ({ name: _.name, value: _.name }),
    json: argv.json,
  });

export const promptOrganizationBackup = async (argv: Options) =>
  createPrompt({
    name: 'backup',
    message: 'Select Snapshot',
    fetcher: async () => GET(API.Backup, argv) as Promise<Backup[]>,
    extractor: (_: Backup) => ({
      name: chalk(
        chalk.bold(_.project.name),
        chalk(
          ',',
          'ver:',
          _.saleor_version,
          ', created on',
          formatDateTime(_.created),
          '-',
        ),
        chalk.bold(_.name),
      ),
      value: _.key,
    }),
    json: argv.json,
  });

export const formatDateTime = (name: string) =>
  format(new Date(name), 'yyyy-MM-dd HH:mm');

export const printContext = ({
  organization,
  environment,
  json,
  short,
}: Arguments<Options>) => {
  if (json || short) {
    return;
  }

  let message = `\n ${chalk.bgGray(' CONTEXT ')}\n`;

  if (organization)
    message += ` ${chalk.gray('Organization')} ${organization} `;
  if (environment)
    message += `- ${chalk.gray('Environment')} ${chalk.underline(environment)}`;

  console.log(`${message}\n`);
};

export const createProject = async (argv: ProjectCreate) => {
  const { promptName } = (await Enquirer.prompt({
    type: 'input',
    name: 'promptName',
    message: 'Type name',
    initial: argv.name,
    skip: !!argv.name,
    validate: (value) => validatePresence(value),
  })) as { promptName: string };

  const chosenRegion = argv.region
    ? { value: argv.region }
    : await promptRegion(argv);
  const chosenPlan = argv.plan ? { value: argv.plan } : await promptPlan(argv);

  const spinner = ora(`Creating project ${promptName}...`).start();

  const project = (await POST(API.Project, argv, {
    json: {
      name: promptName,
      plan: chosenPlan.value,
      region: chosenRegion.value,
    },
  })) as any;

  spinner.succeed(`Yay! Project ${promptName} created!`);

  return { name: project.slug, value: project.slug };
};

export const validateLength = (
  value: string,
  maxLength: number,
  name = '',
  required = false,
): boolean | string => {
  if (required && value.length < 1) {
    return chalk.red('please provide value');
  }

  if (value.length > maxLength) {
    return chalk.red(`${name} please use ${maxLength} characters maximum`);
  }

  return true;
};

export const validateEmail = (
  value: string,
  required = true,
): boolean | string => {
  if (!required && value.length < 1) {
    return true;
  }

  const re = /\S+@\S+\.\S+/;
  if (!re.test(value)) {
    return chalk.red('please provide valid email');
  }

  return true;
};

export const validatePresence = (value: string) => {
  if (value.length < 1) {
    return chalk.red('please provide value');
  }

  return true;
};

export const validateURL = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

export const checkIfJobSucceeded = async (taskId: string): Promise<boolean> => {
  const result = (await GET(API.TaskStatus, { task: taskId })) as any;
  return result.status === 'SUCCEEDED';
};

const simpleProgress = (current = 0): string => {
  const barCompleteChar = '\u2588';
  const barIncompleteChar = '\u2591';
  const progress = current > 100 ? 100 : current;
  const filled = Math.round(progress / 2);
  const left = 50 - filled;
  const bar = `progress [${barCompleteChar.repeat(
    filled,
  )}${barIncompleteChar.repeat(left)}] ${progress}%`;

  return bar;
};

export const waitForTask = async (
  argv: Options,
  taskId: string,
  spinnerText: string,
  spinnerSucceed: string,
) => {
  let currentMsg = 0;
  const messages = [
    `🙌  If you see yourself working on tools like this one, Saleor is looking
      for great educators and DevRel engineers.\n
      Contact us directly at careers@saleor.io or DM on LinkedIn.`,
    `✨  Take your first steps with Saleor's API by checking our tutorial at\n
      https://learn.saleor.io`,
    `⚡  If you like React and Next.js, you may want to take a look at our
      storefront starter pack available at\n
      https://github.com/saleor/react-storefront`,
  ];

  const spinner = ora(`${spinnerText}...`).start();
  let succeed = await checkIfJobSucceeded(taskId);

  if (spinnerText === 'Creating a new environment') {
    let progress = 0;

    while (!succeed) {
      progress += 1;
      await delay(400);
      spinner.text = `${spinnerText}...\n
    ${simpleProgress(progress)}\n
    ${messages[currentMsg]}`;

      const nextMsg = progress % 20 === 0;
      if (nextMsg) {
        currentMsg = progress % 5;
        succeed = await checkIfJobSucceeded(taskId);
      }
    }

    spinner.succeed(`${spinnerSucceed}\n`);
  } else {
    while (!succeed) {
      await delay(10000);
      spinner.text = `${spinnerText}...

    ${messages[currentMsg]}`;

      if (currentMsg === messages.length - 1) {
        currentMsg = 0;
      } else {
        currentMsg += 1;
      }
      succeed = await checkIfJobSucceeded(taskId);
    }

    spinner.succeed(`${spinnerSucceed}\n`);
  }
};

export const showResult = (
  result: Record<string, unknown> | Environment,
  { json }: ResultFormat = { json: false },
) => {
  if (json) {
    print(JSON.stringify(result, null, 2));
  } else {
    console.log(
      emphasize.highlight('yaml', yaml.stringify(result), {
        attr: chalk.blue,
      }).value,
    );
  }
};

export const formatConfirm = (value: string) =>
  chalk.cyan(value ? 'yes' : 'no');

export const confirmRemoval = async (
  argv: Options,
  name: string,
  action = 'remove',
) => {
  const { proceed } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    initial: argv.force,
    skip: !!argv.force,
    message: `You are going to ${action} ${name}. Continue`,
    format: formatConfirm,
  })) as { proceed: boolean };

  return proceed;
};

export const verifyResultLength = (
  result: any[],
  entity: string,
  json?: boolean,
) => {
  if (result.length > 0) {
    return;
  }

  if (json) {
    println('[]');
    process.exit(0);
  }

  const element = entity === 'environment' ? 'organization' : 'environment';
  const entities = ['environment', 'backup', 'webhook', 'project', 'app'];

  console.warn(chalk.red(`\n  No ${entity}s found for this ${element} \n`));
  if (entities.includes(entity)) {
    console.warn(
      chalk(
        `  Create ${entity} with`,
        chalk.green(`saleor ${entity} create`),
        'command',
      ),
    );
  }
  process.exit(0);
};

export const getAppsFromResult = (result: any, json: boolean | undefined) => {
  const apps = result.apps?.edges;
  verifyResultLength(apps || [], 'app', json);

  return apps;
};

// eslint-disable-next-line no-shadow
export enum ChalkColor {
  Green = 'green',
  Yellow = 'yellow',
  Blue = 'blue',
}

export const contentBox = (
  lines: string | string[],
  { title = '', borderBottom = true, color = ChalkColor.Blue } = {},
) => {
  const content = Array.isArray(lines) ? lines.join(' ') : lines;
  const width = process.stdout.columns;
  const wrappedTitle = title.length === 0 ? '' : ` ${title} `;
  const headerLine = chalk[color](
    `──${wrappedTitle}${'─'.repeat(width - wrappedTitle.length - 2)}`,
  );

  console.log(headerLine);
  console.log('');
  console.log(content);
  console.log('');

  if (borderBottom) {
    console.log(chalk[color]('─').repeat(width));
  }
};

export const without = (name: string) => (record: any) => record.name !== name;

export const canOpen = async (command = 'xdg-open'): Promise<boolean> => {
  if (!['darwin', 'win32'].includes(process.platform)) {
    const executable = await lookpath(command);

    if (!executable) {
      return false;
    }
  }

  return true;
};

export const openURL = async (url: string) => {
  const canOpenURL = await canOpen();

  if (!canOpenURL) {
    throw new Error('This command requires browser to operate');
  }

  await open(url);
};

export const successPage = (message: string) => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Saleor CLI</title>
      <style>
        html,
        body {
          height: 100%;
        }

        html {
          display: table;
          margin: auto;
        }

        body {
          display: table-cell;
          vertical-align: middle;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
            "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans",
            "Helvetica Neue", sans-serif;
          background-color: #f3f3f3;
        }
      </style>
    </head>

    <body>
      <h1>${message}</h1>
      <h3>You can close this tab and return to your terminal.</h3>
    </body>
  </html>
  `;

export const countries: { [key: string]: string } = {
  '': '',
  AF: 'Afghanistan',
  AL: 'Albania',
  DZ: 'Algeria',
  AS: 'American Samoa',
  AD: 'Andorra',
  AO: 'Angola',
  AI: 'Anguilla',
  AQ: 'Antarctica',
  AG: 'Antigua and Barbuda',
  AR: 'Argentina',
  AM: 'Armenia',
  AW: 'Aruba',
  AU: 'Australia',
  AT: 'Austria',
  AZ: 'Azerbaijan',
  BS: 'Bahamas (the)',
  BH: 'Bahrain',
  BD: 'Bangladesh',
  BB: 'Barbados',
  BY: 'Belarus',
  BE: 'Belgium',
  BZ: 'Belize',
  BJ: 'Benin',
  BM: 'Bermuda',
  BT: 'Bhutan',
  BO: 'Bolivia (Plurinational State of)',
  BQ: 'Bonaire, Sint Eustatius and Saba',
  BA: 'Bosnia and Herzegovina',
  BW: 'Botswana',
  BV: 'Bouvet Island',
  BR: 'Brazil',
  IO: 'British Indian Ocean Territory (the)',
  BN: 'Brunei Darussalam',
  BG: 'Bulgaria',
  BF: 'Burkina Faso',
  BI: 'Burundi',
  CV: 'Cabo Verde',
  KH: 'Cambodia',
  CM: 'Cameroon',
  CA: 'Canada',
  KY: 'Cayman Islands (the)',
  CF: 'Central African Republic (the)',
  TD: 'Chad',
  CL: 'Chile',
  CN: 'China',
  CX: 'Christmas Island',
  CC: 'Cocos (Keeling) Islands (the)',
  CO: 'Colombia',
  KM: 'Comoros (the)',
  CD: 'Congo (the Democratic Republic of the)',
  CG: 'Congo (the)',
  CK: 'Cook Islands (the)',
  CR: 'Costa Rica',
  HR: 'Croatia',
  CU: 'Cuba',
  CW: 'Curaçao',
  CY: 'Cyprus',
  CZ: 'Czechia',
  CI: 'Côte d\'Ivoire',
  DK: 'Denmark',
  DJ: 'Djibouti',
  DM: 'Dominica',
  DO: 'Dominican Republic (the)',
  EC: 'Ecuador',
  EG: 'Egypt',
  SV: 'El Salvador',
  GQ: 'Equatorial Guinea',
  ER: 'Eritrea',
  EE: 'Estonia',
  SZ: 'Eswatini',
  ET: 'Ethiopia',
  FK: 'Falkland Islands (the) [Malvinas]',
  FO: 'Faroe Islands (the)',
  FJ: 'Fiji',
  FI: 'Finland',
  FR: 'France',
  GF: 'French Guiana',
  PF: 'French Polynesia',
  TF: 'French Southern Territories (the)',
  GA: 'Gabon',
  GM: 'Gambia (the)',
  GE: 'Georgia',
  DE: 'Germany',
  GH: 'Ghana',
  GI: 'Gibraltar',
  GR: 'Greece',
  GL: 'Greenland',
  GD: 'Grenada',
  GP: 'Guadeloupe',
  GU: 'Guam',
  GT: 'Guatemala',
  GG: 'Guernsey',
  GN: 'Guinea',
  GW: 'Guinea-Bissau',
  GY: 'Guyana',
  HT: 'Haiti',
  HM: 'Heard Island and McDonald Islands',
  VA: 'Holy See (the)',
  HN: 'Honduras',
  HK: 'Hong Kong',
  HU: 'Hungary',
  IS: 'Iceland',
  IN: 'India',
  ID: 'Indonesia',
  IR: 'Iran (Islamic Republic of)',
  IQ: 'Iraq',
  IE: 'Ireland',
  IM: 'Isle of Man',
  IL: 'Israel',
  IT: 'Italy',
  JM: 'Jamaica',
  JP: 'Japan',
  JE: 'Jersey',
  JO: 'Jordan',
  KZ: 'Kazakhstan',
  KE: 'Kenya',
  KI: 'Kiribati',
  KP: 'Korea (the Democratic People\'s Republic of)',
  KR: 'Korea (the Republic of)',
  KW: 'Kuwait',
  KG: 'Kyrgyzstan',
  LA: 'Lao People\'s Democratic Republic (the)',
  LV: 'Latvia',
  LB: 'Lebanon',
  LS: 'Lesotho',
  LR: 'Liberia',
  LY: 'Libya',
  LI: 'Liechtenstein',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  MO: 'Macao',
  MG: 'Madagascar',
  MW: 'Malawi',
  MY: 'Malaysia',
  MV: 'Maldives',
  ML: 'Mali',
  MT: 'Malta',
  MH: 'Marshall Islands (the)',
  MQ: 'Martinique',
  MR: 'Mauritania',
  MU: 'Mauritius',
  YT: 'Mayotte',
  MX: 'Mexico',
  FM: 'Micronesia (Federated States of)',
  MD: 'Moldova (the Republic of)',
  MC: 'Monaco',
  MN: 'Mongolia',
  ME: 'Montenegro',
  MS: 'Montserrat',
  MA: 'Morocco',
  MZ: 'Mozambique',
  MM: 'Myanmar',
  NA: 'Namibia',
  NR: 'Nauru',
  NP: 'Nepal',
  NL: 'Netherlands (the)',
  NC: 'New Caledonia',
  NZ: 'New Zealand',
  NI: 'Nicaragua',
  NE: 'Niger (the)',
  NG: 'Nigeria',
  NU: 'Niue',
  NF: 'Norfolk Island',
  MP: 'Northern Mariana Islands (the)',
  NO: 'Norway',
  OM: 'Oman',
  PK: 'Pakistan',
  PW: 'Palau',
  PS: 'Palestine, State of',
  PA: 'Panama',
  PG: 'Papua New Guinea',
  PY: 'Paraguay',
  PE: 'Peru',
  PH: 'Philippines (the)',
  PN: 'Pitcairn',
  PL: 'Poland',
  PT: 'Portugal',
  PR: 'Puerto Rico',
  QA: 'Qatar',
  MK: 'Republic of North Macedonia',
  RO: 'Romania',
  RU: 'Russian Federation (the)',
  RW: 'Rwanda',
  RE: 'Réunion',
  BL: 'Saint Barthélemy',
  SH: 'Saint Helena, Ascension and Tristan da Cunha',
  KN: 'Saint Kitts and Nevis',
  LC: 'Saint Lucia',
  MF: 'Saint Martin (French part)',
  PM: 'Saint Pierre and Miquelon',
  VC: 'Saint Vincent and the Grenadines',
  WS: 'Samoa',
  SM: 'San Marino',
  ST: 'Sao Tome and Principe',
  SA: 'Saudi Arabia',
  SN: 'Senegal',
  RS: 'Serbia',
  SC: 'Seychelles',
  SL: 'Sierra Leone',
  SG: 'Singapore',
  SX: 'Sint Maarten (Dutch part)',
  SK: 'Slovakia',
  SI: 'Slovenia',
  SB: 'Solomon Islands',
  SO: 'Somalia',
  ZA: 'South Africa',
  GS: 'South Georgia and the South Sandwich Islands',
  SS: 'South Sudan',
  ES: 'Spain',
  LK: 'Sri Lanka',
  SD: 'Sudan (the)',
  SR: 'Suriname',
  SJ: 'Svalbard and Jan Mayen',
  SE: 'Sweden',
  CH: 'Switzerland',
  SY: 'Syrian Arab Republic',
  TW: 'Taiwan (Province of China)',
  TJ: 'Tajikistan',
  TZ: 'Tanzania, United Republic of',
  TH: 'Thailand',
  TL: 'Timor-Leste',
  TG: 'Togo',
  TK: 'Tokelau',
  TO: 'Tonga',
  TT: 'Trinidad and Tobago',
  TN: 'Tunisia',
  TR: 'Turkey',
  TM: 'Turkmenistan',
  TC: 'Turks and Caicos Islands (the)',
  TV: 'Tuvalu',
  UG: 'Uganda',
  UA: 'Ukraine',
  AE: 'United Arab Emirates (the)',
  GB: 'United Kingdom of Great Britain and Northern Ireland (the)',
  UM: 'United States Minor Outlying Islands (the)',
  US: 'United States of America (the)',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  VU: 'Vanuatu',
  VE: 'Venezuela (Bolivarian Republic of)',
  VN: 'Viet Nam',
  VG: 'Virgin Islands (British)',
  VI: 'Virgin Islands (U.S.)',
  WF: 'Wallis and Futuna',
  EH: 'Western Sahara',
  YE: 'Yemen',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
  AX: 'Åland Islands',
};
