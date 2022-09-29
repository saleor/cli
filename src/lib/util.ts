/* eslint-disable max-classes-per-file */
import chalk from 'chalk';
import { format } from 'date-fns';
import { emphasize } from 'emphasize';
import Enquirer from 'enquirer';
import got from 'got';
import { lookpath } from 'lookpath';
import ora from 'ora';
import yaml from 'yaml';

import { SaleorAppByID } from '../graphql/SaleorAppByID.js';
import { SaleorAppList } from '../graphql/SaleorAppList.js';
import { API, GET, POST, Region } from '../lib/index.js';
import { Environment, Options, ProjectCreate } from '../types.js';
import { Config } from './config.js';
import { getEnvironmentGraphqlEndpoint } from './environment.js';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return
export const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
export const uncapitalize = (value: string) =>
  value.charAt(0).toLowerCase() + value.slice(1);

interface ResultFormat {
  json?: boolean;
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

export class SaleorAppInstallError extends Error {
  constructor(message = '') {
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

export const fetchLatestPackageVersion = async (name: string) => {
  const { version } = await got
    .get(`https://registry.npmjs.org/${name}/latest`)
    .json<{ version: string }>();
  return version;
};

// Higher-Order Creator for Prompts
const createPrompt = async (
  name: string,
  message: string,
  fetcher: any,
  extractor: any,
  allowCreation = false
) => {
  const collection = await fetcher();

  verifyResultLength(collection, name);

  const creation = allowCreation ? [{ name: 'Create new' }] : [];
  const choices = [...creation, ...collection.map(extractor)];

  const r = (await Enquirer.prompt({
    type: 'select',
    name,
    choices: JSON.parse(JSON.stringify(choices)),
    message,
  })) as any;

  const { [name]: ret } = r;

  const result = choices.find((choice: any) => choice.name === ret);
  if (!result) {
    throw Error('something went wrong with prompt');
  }

  return { name: result.name, value: result.value };
};

export const makeRequestAppList = async (argv: any) => {
  const endpoint = await getEnvironmentGraphqlEndpoint(argv);
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(endpoint, {
      headers,
      json: { query: SaleorAppList },
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

export const checkPnpmPresence = async (entity: string) => {
  const pnpm = await lookpath('pnpm');
  if (!pnpm) {
    console.log(
      chalk.red(`
✘ ${entity} uses the pnpm package manager. To install it, run:`)
    );
    console.log('  npm install -g pnpm');
    process.exit(1);
  }
};

export const promptWebhook = async (argv: any) =>
  createPrompt(
    'webhookID',
    'Select a Webhook',
    async () => {
      const endpoint = await getEnvironmentGraphqlEndpoint(argv);
      const headers = await Config.getBearerHeader();

      const { app: appID } = argv;

      const { data, errors }: any = await got
        .post(endpoint, {
          headers,
          json: {
            query: SaleorAppByID,
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
    ({ id, name, targetUrl }: any) => ({
      name: `${name} (${targetUrl})`,
      value: id,
    })
  );

export const promptSaleorApp = async (argv: any) =>
  createPrompt(
    'app',
    'Select a Saleor App',
    async () => {
      const collection = await makeRequestAppList(argv);
      return collection;
    },
    ({ node: { name, id } }: any) => ({ name, value: id })
  );

export const getSortedServices = async (argv: any) => {
  const services = (await GET(API.Services, {
    region: Region,
    ...argv,
  })) as Record<string, any>[];
  return services.sort((a, b) => b.version.localeCompare(a.version));
};

// deprecated ?
export const promptVersion = async (argv: any) =>
  createPrompt(
    'service',
    'Select a Saleor version',
    async () => getSortedServices(argv),
    (_: any) => ({
      name: `Saleor ${_.version} - ${_.display_name} - ${_.service_type}`,
      value: _.name,
    })
  );

export const promptCompatibleVersion = async (argv: any, service = 'SANDBOX') =>
  createPrompt(
    'production service',
    'Select a Saleor service',
    async () =>
      (await getSortedServices(argv)).filter(
        ({ service_type: serviceType }: any) => serviceType === service
      ),
    (_: any) => ({
      name: `Saleor ${_.version} - ${_.display_name}`,
      value: _.name,
    })
  );

export const promptDatabaseTemplate = async () =>
  createPrompt(
    'database',
    'Select the database template',
    () => [
      {
        name: 'sample',
        value: 'sample',
        hint: 'Includes a sample product catalog and basic configuration',
      },
      {
        name: 'blank',
        value: null,
        hint: 'Contains no data and configuration settings',
      },
      {
        name: 'snapshot',
        value: null,
        hint: 'Import data from backups or your own snapshots',
      },
    ],
    (_: any) => ({ name: _.name, value: _.value, hint: _.hint })
  );

export const promptProject = (argv: any) =>
  createPrompt(
    'project',
    'Select Project',
    async () => GET(API.Project, argv),
    (_: any) => ({ name: _.name, value: _.slug }),
    true
  );

export const promptEnvironment = async (argv: any) =>
  createPrompt(
    'environment',
    'Select Environment',
    async () => GET(API.Environment, { ...argv, environment: '' }),
    (_: any) => ({ name: _.name, value: _.key }),
    false
  );

export const promptOrganization = async (argv: any) =>
  createPrompt(
    'organization',
    'Select Organization',
    async () => GET(API.Organization, argv),
    (_: any) => ({ name: _.name, value: _.slug })
  );

export const promptPlan = async (argv: any) =>
  createPrompt(
    'plan',
    'Select Plan',
    async () => GET(API.Plan, argv),
    (_: any) => ({ name: _.name, value: _.slug })
  );

export const promptRegion = async (argv: any) =>
  createPrompt(
    'region',
    'Select Region',
    async () => GET(API.Region, argv),
    (_: any) => ({ name: _.name, value: _.name })
  );

export const promptOrganizationBackup = async (argv: any) =>
  createPrompt(
    'backup',
    'Select Snapshot',
    async () => GET(API.OrganizationBackups, argv),
    (_: any) => ({
      name: chalk(
        chalk.bold(_.project.name),
        chalk(
          ',',
          'ver:',
          _.saleor_version,
          ', created on',
          formatDateTime(_.created),
          '-'
        ),
        chalk.bold(_.name)
      ),
      value: _.key,
    })
  );

export const formatDateTime = (name: string) =>
  format(new Date(name), 'yyyy-MM-dd HH:mm');

export const printContext = (organization?: string, environment?: string) => {
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

  const choosenRegion = argv.region
    ? { value: argv.region }
    : await promptRegion(argv);
  const choosenPlan = argv.plan ? { value: argv.plan } : await promptPlan(argv);

  const spinner = ora(`Creating project ${promptName}...`).start();

  const project = (await POST(API.Project, argv, {
    json: {
      name: promptName,
      plan: choosenPlan.value,
      region: choosenRegion.value,
    },
  })) as any;

  spinner.succeed(`Yay! Project ${promptName} created!`);

  return { name: project.slug, value: project.slug };
};

export const validateLength = (
  value: string,
  maxLength: number,
  name = '',
  required = false
): boolean | string => {
  if (required && value.length < 1) {
    return chalk.red('please provide value');
  }

  if (value.length > maxLength) {
    console.log(
      chalk.red(`${name} please use ${maxLength} characters maximum`)
    );
    return false;
  }

  return true;
};

export const validateEmail = (
  value: string,
  required = true
): boolean | string => {
  if (!required && value.length < 1) {
    return true;
  }

  const re = /\S+@\S+\.\S+/;
  if (!re.test(value)) {
    console.log(chalk.red('please provide valid email'));
    return false;
  }

  return true;
};

export const validatePresence = (value: string): boolean => {
  if (value.length < 1) {
    console.log(chalk.red('please provide value'));
    return false;
  }

  return true;
};

export const deploy = async ({ name, url }: { name: string; url: string }) => {
  const params = {
    'repository-url': 'https://github.com/saleor/react-storefront',
    'project-name': name || 'my-react-storefront',
    'repository-name': name || 'my-react-storefront',
    env: 'NEXT_PUBLIC_API_URI',
    envDescription: '\'NEXT_PUBLIC_API_URI\' is your GraphQL endpoint',
    envLink: 'https://github.com/saleor/react-storefront',
  };

  const queryParams = new URLSearchParams(params);

  contentBox([
    '  To complete the deployment, open the following link in your browser and continue there: \n\n',
    chalk.blue(`https://vercel.com/new/clone?${queryParams}\n\n`),
    ` Use the following ${chalk.underline(
      'Environment Variables'
    )} for configuration:`,
    `\n\n  ${chalk.gray('NEXT_PUBLIC_API_URI')}=${chalk.yellow(
      `${url}/graphql/`
    )}`,
  ]);
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
    filled
  )}${barIncompleteChar.repeat(left)}] ${progress}%`;

  return bar;
};

export const waitForTask = async (
  argv: Options,
  taskId: string,
  spinnerText: string,
  spinnerSucceed: string
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
      await delay(2000);
      spinner.text = `${spinnerText}...\n
    ${simpleProgress(progress)}\n
    ${messages[currentMsg]}`;

      const nextMsg = progress % 5 === 0;
      if (nextMsg) {
        currentMsg = progress % 3;
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
  { json }: ResultFormat = { json: false }
) => {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      emphasize.highlight('yaml', yaml.stringify(result), {
        attr: chalk.blue,
      }).value
    );
  }
};

export const confirmRemoval = async (argv: Options, name: string) => {
  const { proceed } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'proceed',
    initial: argv.force,
    skip: !!argv.force,
    message: `You are going to remove ${name}. Continue`,
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
  })) as { proceed: boolean };

  return proceed;
};

export const verifyResultLength = (result: any[], entity: string) => {
  if (result.length > 0) {
    return;
  }

  const element = entity === 'environment' ? 'organization' : 'environment';
  const entities = ['environment', 'backup', 'webhook', 'project', 'app'];

  console.warn(chalk.red(`\n  No ${entity}s found for this ${element} \n`));
  if (entities.includes(entity)) {
    console.warn(
      chalk(
        `  Create ${entity} with`,
        chalk.green(`saleor ${entity} create`),
        'command'
      )
    );
  }
  process.exit(0);
};

export const getAppsFromResult = (result: any) => {
  const apps = result.apps?.edges;
  verifyResultLength(apps || [], 'app');

  return apps;
};

export const contentBox = (
  lines: string | string[],
  title = '',
  borderBottom = true
) => {
  const content = Array.isArray(lines) ? lines.join(' ') : lines;
  const width = process.stdout.columns;
  const wrappedTitle = title.length === 0 ? '' : ` ${title} `;
  const headerLine = chalk.blue(
    `──${wrappedTitle}${'─'.repeat(width - wrappedTitle.length - 2)}`
  );

  console.log(headerLine);
  console.log('');
  console.log(content);
  console.log('');

  if (borderBottom) {
    console.log(chalk.blue('─').repeat(width));
  }
};

export const without = (name: string) => (record: any) => record.name !== name;

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
