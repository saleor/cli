import chalk from 'chalk';
import Debug from 'debug';
import Enquirer from 'enquirer';
import { HTTPError, Response } from 'got';
import logSymbols from 'log-symbols';
import slugify from 'slugify';
import { Arguments, CommandBuilder } from 'yargs';

import { API, GET, POST, PUT } from '../../lib/index.js';
import {
  contentBox,
  formatConfirm,
  obfuscateArgv,
  SaleorEnvironmentError,
  validateLength,
  waitForTask,
} from '../../lib/util.js';
import {
  interactiveDatabaseTemplate,
  interactiveProject,
  interactiveSaleorVersion,
} from '../../middleware/index.js';
import { Options, User } from '../../types.js';
import { updateWebhook } from '../webhook/update.js';

interface CommandOptions extends Options {
  domain?: string;
  login?: string;
  pass?: string;
  restore: boolean;
  restoreFrom: string;
  skipRestrict: boolean;
}

const debug = Debug('saleor-cli:env:create');

export const command = 'create [name]';
export const desc = 'Create a new environment';

export const builder: CommandBuilder = (_) =>
  _.positional('name', {
    type: 'string',
    demandOption: false,
    desc: 'name for the new environment',
  })
    .option('project', {
      type: 'string',
      demandOption: false,
      desc: 'create this environment in this project',
    })
    .option('database', {
      type: 'string',
      desc: 'specify how to populate the database',
    })
    .option('saleor', {
      type: 'string',
      desc: 'specify the Saleor version',
    })
    .option('domain', {
      type: 'string',
      desc: 'specify the domain for the environment',
    })
    .option('login', {
      type: 'string',
      desc: 'specify the api Basic Auth login',
    })
    .option('pass', {
      type: 'string',
      desc: 'specify the api Basic Auth password',
    })
    .option('restore-from', {
      type: 'string',
      desc: 'specify snapshot id to restore database from',
    })
    .option('skip-restrict', {
      type: 'boolean',
      desc: 'skip Basic Auth restriction prompt',
    })
    .example('saleor env create my-environment', '')
    .example(
      'saleor env create my-environment --project=project-name --database=sample --saleor=saleor-master-staging --domain=project-domain --skip-restrict',
      ''
    )
    .example(
      'saleor env create my-environment --organization=organization-slug --project=project-name --database=sample --saleor=saleor-master-staging --domain=project-domain --skip-restrict',
      ''
    );

export const handler = async (argv: Arguments<CommandOptions>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  debug('creating environment');
  const result = await createEnvironment(argv);

  if (argv.restoreFrom) {
    const { update } = await Enquirer.prompt<{ update: string }>({
      type: 'confirm',
      name: 'update',
      message: 'Would you like to update webhooks targetUrl',
    });

    debug('updating the webhooks');
    if (update) {
      const endpoint = `https://${result.domain}/graphql/`;
      await updateWebhook(endpoint, argv.json);
    }
  }
};

export const createEnvironment = async (argv: Arguments<CommandOptions>) => {
  const { project, saleor, database } = argv;

  debug('getting user from Saleor API');
  const user = (await GET(API.User, argv)) as User;

  if (argv.restore && !argv.restoreFrom) {
    throw new SaleorEnvironmentError(
      '`restore-from` option is required for database snapshot'
    );
  }

  const { name } = (await Enquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Environment name',
      initial: argv.name,
      required: true,
      skip: !!argv.name,
      validate: (value) => validateLength(value, 255),
    },
  ])) as { name: string };

  const domain = await validateDomain(argv, name);

  const { restrict } = (await Enquirer.prompt({
    type: 'confirm',
    name: 'restrict',
    message: 'Would you like to restrict your Environment API with Basic Auth?',
    format: formatConfirm,
    skip: (!!argv.pass && !!argv.login) || argv.skipRestrict,
  })) as { restrict: boolean };

  let { login } = argv;
  let password = argv.pass;

  if (restrict) {
    const { loginPrompt, passwordPrompt } = (await Enquirer.prompt([
      {
        type: 'input',
        name: 'loginPrompt',
        message: 'Login',
        required: true,
        initial: argv.login,
        validate: (value) => validateLength(value, 128),
      },
      {
        type: 'password',
        name: 'passwordPrompt',
        message: 'Password',
        required: true,
        initial: argv.pass,
        validate: (value) => validateLength(value, 128),
      },
    ])) as { loginPrompt: string; passwordPrompt: string };

    await Enquirer.prompt({
      type: 'password',
      name: 'confirmation',
      message: 'Confirm password',
      required: true,
      initial: argv.pass,
      validate: (value) => {
        if (value !== passwordPrompt) {
          return chalk.red('Passwords must match');
        }
        return true;
      },
    });

    login = loginPrompt;
    password = passwordPrompt;
  }

  const json = {
    name,
    domain_label: domain,
    project,
    database_population: database,
    service: saleor,
    login,
    password,
    restore_from: argv.restoreFrom,
  };

  const result = await getResult(json, argv);

  await waitForTask(
    argv,
    result.task_id,
    'Creating a new environment',
    'Yay! A new environment is now ready!'
  );

  const baseUrl = `https://${result.domain}`;
  const dashboardMsg = chalk(
    '           Dashboard:',
    chalk.blue(`${baseUrl}/dashboard`)
  );

  const gqlMsg = chalk(
    '  GraphQL Playground:',
    chalk.blue(`${baseUrl}/graphql/`)
  );

  contentBox(`${dashboardMsg}\n${gqlMsg}`);

  return result;
};

export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
];

const getDomain = async (
  argv: Arguments<CommandOptions>,
  name: string,
  errorMsg: string,
  initial: string | undefined = undefined
) => {
  const { domain } = await Enquirer.prompt<{ domain: string }>({
    type: 'input',
    name: 'domain',
    message: 'Environment domain',
    initial:
      initial || slugify(argv.domain || argv.name || name || '').toLowerCase(),
    required: true,
    skip: !!argv.domain,
    validate: (value) => {
      if (initial && value === initial) {
        return chalk.red(errorMsg);
      }

      validateLength(value, 40);

      return true;
    },
  });

  return domain;
};

const validateDomain = async (
  argv: Arguments<CommandOptions>,
  name: string
) => {
  let loop = true;
  let domain;
  const msg = `${logSymbols.error} The environment with this domain already exists.`;

  domain = await getDomain(argv, name, msg);
  const json = { domain_label: domain };

  while (loop) {
    try {
      await PUT(API.DomainCheck, argv, { json });
      loop = false;
      return domain;
    } catch (error) {
      if (error instanceof HTTPError) {
        const { body } = error.response as Response<any>;
        const errors: Record<string, string[]> = JSON.parse(body);
        for (const [errorMsg] of Object.values(errors)) {
          switch (errorMsg) {
            case 'environment with this domain label already exists.': {
              console.log(chalk.red(msg));
              domain = await getDomain(argv, name, msg, json.domain_label);
              json.domain_label = domain;
              break;
            }
            default:
              throw error;
          }
        }
      }
    }
  }

  return domain;
};

const getResult = async (
  json: Record<string, any>,
  argv: Arguments<Options>
) => {
  let loop = true;
  const _json = { ...json };
  let result;

  while (loop) {
    try {
      const data = (await POST(
        API.Environment,
        { ...argv, environment: '' },
        { json: _json }
      )) as any;
      loop = false;

      result = data;
    } catch (error) {
      if (error instanceof HTTPError) {
        const { body } = error.response as Response<any>;
        const errors: Record<string, string[]> = JSON.parse(body);
        for (const [errorMsg] of Object.values(errors)) {
          switch (errorMsg) {
            case 'environment with this domain label already exists.': {
              const { newValue } = await Enquirer.prompt<{ newValue: string }>({
                type: 'input',
                name: 'newValue',
                message: 'Environment domain',
                initial: _json.domain_label,
                required: true,
                validate: (value) => {
                  if (value === _json.domain_label) {
                    return chalk.red(errorMsg);
                  }

                  return true;
                },
              });

              _json.domain_label = newValue;
              break;
            }
            case 'The fields name, project must make a unique set.': {
              const { newValue } = await Enquirer.prompt<{ newValue: string }>({
                type: 'input',
                name: 'newValue',
                message: 'Environment name',
                initial: _json.name,
                required: true,
                validate: (value) => {
                  if (value === _json.name) {
                    return chalk.red(errorMsg);
                  }

                  return true;
                },
              });

              _json.name = newValue;
              break;
            }
            default:
              throw error;
          }
        }
      }
    }
  }

  return result;
};
