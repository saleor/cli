import chalk from "chalk";
import Debug from "debug"
import Enquirer from "enquirer";
import got from "got";
import { Arguments } from "yargs";
import { configure } from "../cli/configure.js";
import { Config } from "../lib/config.js"
import { promptDatabaseTemplate, promptEnvironment, promptOrganization, promptOrganizationBackup, promptProject, promptVersion } from "../lib/util.js";
import { CreatePromptResult, Options } from "../types.js";

const debug = Debug('middleware'); 

type Handler = (opts: Options) => (Options | Promise<Options>)

export const useToken = async ({ token }: Options) => {
  let opts = {};

  if (!token) {
    const config = await Config.get()
    debug('useDefault', config)
    const { token } = config;

    if (token) {
      debug('token read from file')
      opts = { ...opts, token}
    } else {
      console.error(chalk.red("Auth token missing"));
      console.error("Please create token and run " + chalk.green("saleor configure"))

      const { runConfig } = await Enquirer.prompt({
        type: 'confirm',
        name: 'runConfig',
        message: 'Would you like to run `saleor configure` now ?'
      }) as { runConfig: boolean }

      if (runConfig) {
        debug('running configure')
        const newToken = await configure(undefined)
        opts = { ...opts, token: newToken}
      }
    }
  }

  return opts;
}

export const useOrganization = async ({ token, organization }: Options) => {
  let opts = { token, organization };

  if (!organization) {
    const config = await Config.get()
    debug('useDefault', config)
    const { organization_slug } = config;

    if (organization_slug) {
      debug('org read from file')
      opts = { ...opts, ...{ organization: organization_slug } }
    } else {
      const organization = await promptOrganization(opts);
      await Config.set("organization_slug", organization.value);
      await Config.set("organization_name", organization.name);
      opts = { ...opts, ...{ organization: organization.value }}
    }
  }

  console.log(chalk.green("✔"), chalk.bold("Organization ·"), chalk.cyan(opts.organization));

  return opts;
}

export const useEnvironment = async ({ token, organization, environment }: Options) => {
  let opts = { token, organization };

  if (!environment) {
    const config = await Config.get();
    debug('useDefault', config);
    const { environment_id } = config;

    if (environment_id) {
      debug('env read from file')
      opts = { ...opts, ...{environment: environment_id} }
    } else {
      const environment = await promptEnvironment(opts);
      opts = { ...opts, ...{environment: environment.value} }
    }
  }

  return opts; 
}

export const interactiveProject = async (argv: Options) => {
  if (!argv.project) {
    const project = await promptProject(argv);
    return { project: project.value }
  }

  return {}
}

export const interactiveDatabaseTemplate = async (argv: Options) => {
  if (!argv.database) {
    const db = await promptDatabaseTemplate(argv);
    const backup = await checkBackup(argv, db);
    return { database: db.value, ...backup };
  }

  return {}
}

export const interactiveSaleorVersion = async (argv: Options) => {
  if (!argv.saleor) {
    const snapshot = await promptVersion(argv);
    return { saleor: snapshot.value }
  }

  return {}
}

export const useTelemetry = async (argv: Arguments) => {
  const command = argv._.join(" ")

  const { telemetry } = await Config.get()
  const isTelemetryEnabled = telemetry === undefined

  debug('is telemetry enabled', isTelemetryEnabled);

  if (isTelemetryEnabled) {
    debug('telemetry', argv._);
    got.post("https://saleor-cli.deno.dev", {
      json: { command },
    });
  }

  return {}
}

const checkBackup = async (argv: Options, chosenBackup: CreatePromptResult) => {
  const { name } = chosenBackup;

  if (name === 'snapshot') {
    const backup = await promptOrganizationBackup(argv);
    return { restore_from: backup.value }
  }

  return {}
}
