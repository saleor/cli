import { exec } from 'node:child_process';
import util from 'node:util';

import chalk from 'chalk';
import Debug from 'debug';
import enquirer from 'enquirer';
import fs from 'fs-extra';
import got, { HTTPError } from 'got';
import logSymbols from 'log-symbols';
import ora from 'ora';
import path from 'path';
import { Arguments } from 'yargs';

import * as Configuration from '../config.js';
import { Config } from '../lib/config.js';
import { getEnvironment as getEnv } from '../lib/environment.js';
import { API, GET, getEnvironment } from '../lib/index.js';
import { extractDataFromInstance, validateInstance } from '../lib/instance.js';
import { isNotFound } from '../lib/response.js';
import {
  AuthError,
  createProject,
  printlnSuccess,
  promptCompatibleVersion,
  promptDatabaseTemplate,
  promptEnvironment,
  promptOrganization,
  promptOrganizationBackup,
  promptProject,
  promptSaleorApp,
  promptWebhook,
} from '../lib/util.js';
import { CreatePromptResult, Environment, Job, Options } from '../types.js';

const debug = Debug('saleor-cli:middleware');

export const useToken = async ({ token }: Options) => {
  let opts = {};

  if (!token) {
    const config = await Config.get();
    const { token: configToken } = config;

    if (configToken) {
      debug('token read from file');
      opts = { ...opts, token: configToken };
    } else {
      console.error(chalk.red('\nYou are not logged in\n'));
      console.error(
        chalk(
          'If you have an account - login using',
          chalk.bold.green('saleor login')
        )
      );
      console.error(
        chalk(
          'If you don\'t have an account - register using',
          chalk.bold.green('saleor register')
        )
      );

      process.exit(1);
    }
  }

  return opts;
};

export const useInstanceConnector = async (argv: Options) => {
  const { instance } = argv;

  if (instance) {
    const instanceURL = validateInstance(instance);
    const _argv = {
      ...(await useToken(argv)),
      instance: instanceURL,
    };

    const { organization, environment } = await extractDataFromInstance(_argv);

    return {
      ..._argv,
      organization,
      environment,
    };
  }

  const stacked = useInstanceAttacher({
    ...argv,
    ...(await useEnvironment({
      ...argv,
      ...(await useOrganization({
        ...argv,
        ...(await useToken(argv)),
      })),
    })),
  });

  return stacked;
};

export const useInstanceAttacher = async (argv: Options) => {
  const instance = await getEnv(argv as Arguments);

  return {
    ...argv,
    instance: `https://${instance.domain}`,
  };
};

export const useAppConfig = async (_argv: Options) => {
  try {
    const content = await fs.readFile(
      path.join(process.cwd(), 'saleor.config.json'),
      'utf-8'
    );
    const config = JSON.parse(content);
    const instance = config.SaleorInstanceURL;

    return { instance };
  } catch (error) {
    return {};
  }
};

export const useOrganization = async ({
  token,
  organization,
  json,
}: Options) => {
  let opts = { token, organization };

  if (!organization) {
    const config = await Config.get();
    const { organization_slug: organizationSlug } = config;

    if (organizationSlug) {
      debug('org read from file');
      opts = { ...opts, ...{ organization: organizationSlug } };
    } else {
      const org = await promptOrganization(opts);
      await Config.set('organization_slug', org.value);
      await Config.set('organization_name', org.name);
      opts = { ...opts, ...{ organization: org.value } };
    }
  }

  if (!json) {
    console.warn(
      chalk.green(logSymbols.success),
      chalk.bold('Organization ·'),
      chalk.cyan(opts.organization)
    );
  }

  return opts;
};

const getEnvironmentByName = async (
  token: string,
  organization: string,
  environment: string
) => {
  const environments = (await GET(API.Environment, {
    token,
    organization,
  })) as Environment[];
  const { key } =
    environments.filter(
      ({ name }: { name: string }) => name === environment
    )[0] || {};

  return key;
};

export const verifyEnvironment = async (
  token: string,
  organization: string,
  environment: string
) => {
  const spinner = ora(
    chalk(chalk.bold('Environment ·'), chalk.cyan(environment))
  ).start();
  let env: Environment;

  try {
    env = (await GET(API.Environment, {
      token,
      organization,
      environment,
    })) as Environment;
  } catch (error) {
    const key = await getEnvironmentByName(token, organization, environment);

    if (key) {
      env = (await GET(API.Environment, {
        token,
        organization,
        environment: key,
      })) as Environment;
    } else {
      if (isNotFound(error)) {
        spinner.fail(
          chalk.red(
            chalk.bold('Environment ·'),
            environment,
            '- not found in the Saleor Cloud'
          )
        );
        process.exit(1);
      }

      throw error;
    }
  }

  spinner.succeed(
    chalk(chalk.bold('Environment ·'), chalk.cyan(`${env.name} - ${env.key}`))
  );

  return env;
};

export const useEnvironment = async ({
  token,
  organization,
  environment,
  json,
}: Options) => {
  let opts = { token, organization, environment };

  if (!token) {
    throw chalk(
      'Missing auth token. Run',
      chalk.green('saleor login'),
      'to authenticate Saleor CLI to Saleor Cloud'
    );
  }

  if (!organization) {
    throw chalk(
      'Missing organization. Run',
      chalk.green('saleor organization switch'),
      'to choose default one'
    );
  }

  if (environment) {
    const env: Environment = await verifyEnvironment(
      token,
      organization,
      environment
    );
    opts = { ...opts, ...{ environment: env.key } };
  } else {
    const config = await Config.get();
    const { environment_id: environmentId } = config;

    if (environmentId) {
      debug('env read from file');

      await verifyEnvironment(token, organization, environmentId);
      opts = { ...opts, ...{ environment: environmentId } };
    } else {
      const env = await promptEnvironment(opts);
      opts = { ...opts, ...{ environment: env.value } };

      if (!json) {
        printlnSuccess(
          chalk(
            chalk.bold('Environment ·'),
            chalk.cyan(`${env.name} - ${env.value}`)
          )
        );
      }
    }
  }

  return opts;
};

export const interactiveProject = async (argv: Options) => {
  if (!argv.project) {
    const project = await promptProject(argv);
    if (project.value === undefined) {
      const newProject = await createProject(argv);
      return { project: newProject.value };
    }
    return { project: project.value };
  }

  return {};
};

export const interactiveDatabaseTemplate = async (argv: Options) => {
  if (!argv.database) {
    const db = await promptDatabaseTemplate();
    const backup = await checkBackup(argv, db);
    return { database: db.value, ...backup };
  }

  if (argv.database === 'blank') return { database: null };
  if (argv.database === 'snapshot') return { database: null, restore: true };

  return {};
};

export const interactiveSaleorVersion = async (argv: Options) => {
  const { region } = (await GET(API.Project, argv)) as any;

  if (!argv.saleor) {
    const snapshot = await promptCompatibleVersion({ ...argv, region });
    return { saleor: snapshot.value };
  }

  return {};
};

export const interactiveDashboardLogin = async (argv: Arguments<Options>) => {
  const doLogin = `
mutation login($email: String!, $password: String!) {
  tokenCreate(email: $email, password: $password) {
    csrfToken
    token
    refreshToken
  }
}
`;

  if (!argv.email && !argv.password) {
    const { email } = await enquirer.prompt<{ email: string }>({
      type: 'text',
      name: 'email',
      message: 'Your Saleor Dashboard email?',
    });
    const { password } = await enquirer.prompt<{ password: string }>({
      type: 'password',
      name: 'password',
      message: 'Your password?',
    });

    const { instance } = argv;
    const endpoint = `${instance}/graphql/`;

    const { data, errors }: any = await got
      .post(endpoint, {
        json: {
          query: doLogin,
          variables: { email, password },
        },
      })
      .json();

    if (errors) {
      throw new AuthError('cannot login to dashboard');
    }

    const {
      tokenCreate: { csrfToken, refreshToken },
    } = data;
    return { csrfToken, refreshToken };
  }

  return {};
};

export const interactiveSaleorApp = async (argv: Options) => {
  if (!argv.app) {
    const app = await promptSaleorApp(argv);
    return { app: app.value };
  }

  return {};
};

export const interactiveWebhook = async (argv: Options) => {
  if (!argv.webhookID) {
    const webhookID = await promptWebhook(argv);
    return { webhookID: webhookID.value };
  }

  return {};
};

export const useOnlineChecker = async () => {
  // check only if not in CI
  // `ping` doesn't work in GitHub Actions
  // ref. https://github.com/actions/runner-images/issues/1519#issuecomment-683790054
  if (!process.env.CI) {
    try {
      await util.promisify(exec)(
        `ping ${process.platform === 'win32' ? '-n' : '-c'} 1 1.1.1.1`
      );
    } catch (error) {
      console.error(
        `You are ${chalk.red(
          'offline'
        )}. Saleor CLI requires Internet access to operate. Check your connection.`
      );
      process.exit(1);
    }
  }
};

export const useTelemetry = (version: string) => async (argv: Arguments) => {
  const command = argv._.join(' ');

  const { telemetry } = await Config.get();
  const isTelemetryEnabled = telemetry === undefined;

  const environment = await getEnvironment();
  const { user_session: userSession } = await Config.get();

  debug('is telemetry enabled', isTelemetryEnabled);

  if (isTelemetryEnabled) {
    debug('telemetry', argv._);

    got
      .post(Configuration.TelemetryDomain, {
        json: { command, environment, version, user_session: userSession },
        timeout: {
          request: 2000,
        },
      })
      .catch((error) => {
        if (error instanceof HTTPError) {
          console.warn(`${chalk.yellow('Warning')} Telemetry is down `);
        }

        // FIXME notify Sentry
      });
  }
};

const checkBackup = async (argv: Options, chosenBackup: CreatePromptResult) => {
  const { name } = chosenBackup;

  if (name === 'snapshot') {
    const backup = await promptOrganizationBackup(argv);
    return { restore_from: backup.value };
  }

  return {};
};

export const useGithub = async () => {
  const { github_token: githubToken } = await Config.get();

  if (!githubToken) {
    console.error(chalk.red('\nYou are not logged into Github\n'));
    console.log(
      chalk('Run', chalk.bold.green('saleor github login'), 'command to login')
    );

    process.exit(1);
  }

  return {};
};

export const useVercel = async () => {
  const { vercel_token: vercelToken } = await Config.get();

  if (!vercelToken) {
    console.error(chalk.red('\nYou are not logged into Vercel\n'));
    console.log(
      chalk('Run', chalk.bold.green('saleor vercel login'), 'command to login')
    );

    process.exit(1);
  }

  return {};
};

export const useAvailabilityChecker = async (argv: Options) => {
  const { maintenance_mode: maintenance, disabled } = await getEnv(
    argv as Arguments
  );

  if (maintenance) {
    throw new Error('The selected environment is in the maintenance mode');
  }

  if (disabled) {
    throw new Error(
      'The selected environment has exceeded maximum request count'
    );
  }

  return {};
};

export const useBlockingTasksChecker = async (argv: Options) => {
  const { blocking_tasks_in_progress: blockingTasksInProgress } = await getEnv(
    argv as Arguments
  );

  if (blockingTasksInProgress) {
    const jobs = (await GET(API.Job, argv)) as Job[];
    const pending = jobs
      .filter(
        ({ status, is_blocking: isBlocking }) =>
          isBlocking && ['IN_PROGRESS', 'PENDING'].includes(status)
      )
      .map(
        ({ job_name: jobName, status }) =>
          ` ${jobName.split('-').reverse().shift()} - ${status}\n`
      );

    throw new Error(
      `The selected operation can't be performed at the moment.
 Please wait for pending jobs to finish.\n
${pending}
 Use ${chalk.green('saleor job list')} command to list jobs`
    );
  }

  return {};
};
