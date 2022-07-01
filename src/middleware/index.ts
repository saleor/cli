import chalk from "chalk";
import Debug from "debug";
import enquirer from "enquirer";
import got, { HTTPError } from "got";
import { Arguments } from "yargs";

import * as Configuration from "../config.js";
import { Config } from "../lib/config.js";
import { API, GET, getEnvironment } from "../lib/index.js";
import {
  AuthError,
  createProject,
  promptCompatibleVersion,
  promptDatabaseTemplate,
  promptEnvironment,
  promptOrganization,
  promptOrganizationBackup,
  promptProject,
  promptSaleorApp,
  promptWebhook,
} from "../lib/util.js";
import { CreatePromptResult, Options } from "../types.js";

const debug = Debug("middleware");

type Handler = (opts: Options) => Options | Promise<Options>;

export const useToken = async ({ token }: Options) => {
  let opts = {};

  if (!token) {
    const config = await Config.get();
    debug("useDefault", config);
    const { token: configToken } = config;

    if (configToken) {
      debug("token read from file");
      opts = { ...opts, token: configToken };
    } else {
      console.error(chalk.red("\nYou are not logged in\n"));
      console.error(
        chalk(
          "If you have an account - login using",
          chalk.bold.green("saleor login")
        )
      );
      console.error(
        chalk(
          "If you don't have an account - register using",
          chalk.bold.green("saleor register")
        )
      );

      process.exit(1);
    }
  }

  return opts;
};

export const useOrganization = async ({ token, organization }: Options) => {
  let opts = { token, organization };

  if (!organization) {
    const config = await Config.get();
    debug("useDefault", config);
    const { organization_slug: organizationSlug } = config;

    if (organizationSlug) {
      debug("org read from file");
      opts = { ...opts, ...{ organization: organizationSlug } };
    } else {
      const org = await promptOrganization(opts);
      await Config.set("organization_slug", org.value);
      await Config.set("organization_name", org.name);
      opts = { ...opts, ...{ organization: org.value } };
    }
  }

  console.log(
    chalk.green("✔"),
    chalk.bold("Organization ·"),
    chalk.cyan(opts.organization)
  );

  return opts;
};

export const useEnvironment = async ({
  token,
  organization,
  environment,
}: Options) => {
  let opts = { token, organization, environment };

  if (!environment) {
    const config = await Config.get();
    debug("useDefault", config);
    const { environment_id: environmentId } = config;

    if (environmentId) {
      debug("env read from file");
      opts = { ...opts, ...{ environment: environmentId } };
    } else {
      const env = await promptEnvironment(opts);
      opts = { ...opts, ...{ environment: env.value } };
    }
  }

  console.log(
    chalk.green("✔"),
    chalk.bold("Environment ·"),
    chalk.cyan(opts.environment)
  );

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

  if (argv.database === "blank") return { database: null };
  if (argv.database === "snapshot") return { database: null, restore: true };

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

export const interactiveDashboardLogin = async (argv: Options) => {
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
      type: "text",
      name: "email",
      message: "Your Saleor Dashboard email?",
    });
    const { password } = await enquirer.prompt<{ password: string }>({
      type: "password",
      name: "password",
      message: "Your password?",
    });

    const { domain } = (await GET(API.Environment, argv)) as any;

    const { data, errors }: any = await got
      .post(`https://${domain}/graphql`, {
        json: {
          query: doLogin,
          variables: { email, password },
        },
      })
      .json();

    if (errors) {
      throw new AuthError("cannot login to dashboard");
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

export const useTelemetry = (version: string) => async (argv: Arguments) => {
  const command = argv._.join(" ");

  const { telemetry } = await Config.get();
  const isTelemetryEnabled = telemetry === undefined;

  const environment = await getEnvironment();
  const { user_session: userSession } = await Config.get();

  debug("is telemetry enabled", isTelemetryEnabled);

  if (isTelemetryEnabled) {
    debug("telemetry", argv._);

    try {
      got.post(Configuration.TelemetryDomain, {
        json: { command, environment, version, user_session: userSession },
        timeout: {
          request: 2000,
        },
      });
    } catch (error) {
      if (error instanceof HTTPError) {
        console.error(`${chalk.yellow("Warning")} Telemetry is down `);
      }
      // FIXME
    }
  }
};

const checkBackup = async (argv: Options, chosenBackup: CreatePromptResult) => {
  const { name } = chosenBackup;

  if (name === "snapshot") {
    const backup = await promptOrganizationBackup(argv);
    return { restore_from: backup.value };
  }

  return {};
};

export const useGithub = async () => {
  const { github_token: githubToken } = await Config.get();

  if (!githubToken) {
    console.error(chalk.red("\nYou are not logged into Github\n"));
    console.log(
      chalk("Run", chalk.bold.green("saleor github login"), "command to login")
    );

    process.exit(1);
  }

  return {};
};

export const useVercel = async () => {
  const { vercel_token: vercelToken } = await Config.get();

  if (!vercelToken) {
    console.error(chalk.red("\nYou are not logged into Vercel\n"));
    console.log(
      chalk("Run", chalk.bold.green("saleor vercel login"), "command to login")
    );

    process.exit(1);
  }

  return {};
};
