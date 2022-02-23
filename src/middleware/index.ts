import chalk from "chalk";
import Debug from "debug"
import Enquirer from "enquirer";
import { configure } from "../cli/configure.js";
import { Config } from "../lib/config.js"
import { promptDatabaseTemplate, promptEnvironment, promptProject, promptVersion } from "../lib/util.js";
import { Options } from "../types.js";

const debug = Debug('middleware'); 

type Handler = (opts: Options) => (Options | Promise<Options>)

export const useDefault = async ({ token, organization, environment }: Options) => {
  let opts: any = {};

  if (!token || !organization || !environment) {
    const config = await Config.get()
    debug('useDefault', config)
    let { token ,organization_slug, environment_id } = config;
    opts = config;

    if (token) {
      debug('token read from file')
    } else {
      console.error(chalk.red("Auth token missing"));
      console.error("Please create token and run " + chalk.green("saleor configure"))

      const { runConfig } = await Enquirer.prompt({
        type: 'confirm',
        name: 'runConfig',
        message: 'Would you like to run `saleor configure` now ?'
      }) as { runConfig: boolean }

      if (runConfig) {
        await configure(undefined)
        opts = await Config.get()
        organization_slug = opts.organization_slug
      } else {
        process.exit(0);
      }
    }

    if (organization_slug) {
      debug('org read from file')
      opts = { ...opts, organization: organization_slug }
    } else {
    }

    if (environment_id) {
      debug('env read from file')
      opts = { ...opts, environment: environment_id }
    } else {
      const environment = await promptEnvironment(opts);
      opts = { ...opts, environment: environment.value }
    }

    return opts; 
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
    const database = await promptDatabaseTemplate(argv);
    return { database: database.value }
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