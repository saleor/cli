import { Arguments, CommandBuilder } from "yargs";

import { interactiveDatabaseTemplate, interactiveProject, interactiveSaleorVersion } from "../../middleware/index.js";
import { deploy, validateEmail, validateLength, waitForTask } from "../../lib/util.js";
import chalk from "chalk";
import Enquirer from "enquirer";
import slugify from "slugify";
import boxen from "boxen";
import { HTTPError, Response } from "got";
import { API, GET, POST } from "../../lib/index.js";
import { updateWebhook } from "../webhook/update.js";
interface Options {
  name: string
  project: string
  saleor: string
  database: string
  domain: string
  login?: string
  pass?: string
  deploy: boolean
  restore: boolean
  restore_from: string
  skipRestrict: boolean
}

export const command = "create [name]";
export const desc = "Create a new environment";

export const builder: CommandBuilder = (_) =>
  _.positional("name", {
    type: "string",
    demandOption: false,
    desc: 'name for the new environment'
  })
    .option("project", {
      type: 'string',
      demandOption: false,
      desc: 'create this environment in this project',
    })
    .option("database", {
      type: 'string',
      desc: 'specify how to populate the database',
    })
    .option("saleor", {
      type: 'string',
      desc: 'specify the Saleor version',
    })
    .option("domain", {
      type: 'string',
      desc: 'specify the domain for the envronment',
    })
    .option("email", {
      type: 'string',
      desc: 'specify the dashboard access email',
    })
    .option("login", {
      type: 'string',
      desc: 'specify the api Basic Auth login',
    })
    .option("pass", {
      type: 'string',
      desc: 'specify the api Basic Auth password',
    })
    .option("deploy", {
      type: 'boolean',
      desc: 'specify Vercel deployment',
    })
    .option("restore_from", {
      type: 'string',
      desc: 'specify snapshot id to restore database from',
    })

export const handler = async (argv: Arguments<Options>) => {
  const result = await createEnvironment(argv);

  if (!!argv.restore_from) {
    const { update } = await Enquirer.prompt<{ update: string }>({
      type: "confirm",
      name: 'update',
      message: 'Would you like to update webhooks targetUrl',
    });

    if (update) {
      await updateWebhook(result.domain);
    }
  }

  const { deployPrompt } = await Enquirer.prompt({
    type: 'confirm',
    name: 'deployPrompt',
    message: `Deploy our react-storefront starter pack to Vercel`,
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
    initial: argv.deploy,
    skip: !(argv.deploy === undefined)
  }) as { deployPrompt: boolean };

  if (deployPrompt) {
    await deploy({ name: result.name, url: `https://${result.domain}` })
  }
};

export const createEnvironment = async (argv: Arguments<Options>) => {
  const { project, saleor, database } = argv;
  const user = (await GET(API.User, argv)) as any;

  if (argv.restore && !argv.restore_from) {
    console.log(chalk.red(`Error: \`restore_from\` option is requried for database snapshot`))
    return
  }

  const { name } = await Enquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Environment name',
    initial: argv.name,
    required: true,
    skip: !!argv.name,
    validate: (value) => validateLength(value, 255)
  }]) as { name: string };

  const { domain, access } = await Enquirer.prompt([{
    type: 'input',
    name: 'domain',
    message: 'Environment domain',
    initial: slugify(argv.domain || argv.name || name || ''),
    required: true,
    skip: !!argv.domain,
    validate: (value) => validateLength(value, 40)
  }, {
    type: 'confirm',
    name: 'access',
    message: `Would you like to enable dashboard access?`,
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
    skip: !!argv.email,
    initial: true 
  }]) as { domain: string, access: boolean };

  let email = argv.email;

  if (access) {
    const { emailPrompt } = await Enquirer.prompt({
      type: 'input',
      name: 'emailPrompt',
      message: `Dashboard admin email`,
      initial: argv.email || user.email,
      validate: (value) => validateEmail(value)
    }) as { emailPrompt: string };

    email = emailPrompt;
  }

  const { restrict } = await Enquirer.prompt({
    type: 'confirm',
    name: 'restrict',
    message: `Would you like to restrict your Environment API with Basic Auth?`,
    format: (value) => chalk.cyan(value ? 'yes' : 'no'),
    skip: (!!argv.pass && !!argv.login) || argv.skipRestrict
  }) as { restrict: boolean };

  let login = argv.login;
  let password = argv.pass;

  if (restrict) {
    const { loginPrompt, passwordPrompt } = await Enquirer.prompt([{
      type: 'input',
      name: 'loginPrompt',
      message: `Login`,
      required: true,
      initial: argv.login || user.email,
      validate: (value) => validateLength(value, 128)
    },
    {
      type: 'password',
      name: 'passwordPrompt',
      message: `Password`,
      required: true,
      initial: argv.pass,
      validate: (value) => validateLength(value, 128)
    }]) as { loginPrompt: string, passwordPrompt: string };

    await Enquirer.prompt({
      type: 'password',
      name: 'confirmation',
      message: `Confirm password`,
      required: true,
      initial: argv.pass,
      validate: (value) => {
        if (value !== passwordPrompt) {
          return chalk.red(`Passwords must match`)
        }
        return true
      }
    })

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
    restore_from: argv.restore_from
  }

  const result = await getResult(json, argv);

  await waitForTask(argv, result.task_id, 'Creating a new environment', 'Yay! A new environment is now ready!')

  const baseUrl = `https://${result.domain}`;
  const dashboaardMsg = chalk.blue(`Dashboard - ${baseUrl}/dashboard`);
  const accessMsg = (access || !!argv.email) ? `Please check your email - ${email} - to setup your dashboaard access.` : '';
  const gqlMsg = chalk.blue(`GraphQL Playgroud - ${baseUrl}/graphql/`);
  console.log(boxen(`${dashboaardMsg}
  ${accessMsg}
${gqlMsg}`, { padding: 1, borderStyle: 'round' }));

  if (access || !!argv.email) {
    await GET(API.SetAdminAccount, { ...argv, environment: result.key }) as any;
  }

  return result
}

export const middlewares = [
  interactiveProject,
  interactiveDatabaseTemplate,
  interactiveSaleorVersion,
]

const getResult = async (json: Record<string, any>, argv: Arguments<Options>) => {
  let loop = true;
  const _json = { ...json };

  while (loop) {
    try {
      const result = await POST(API.Environment, { ...argv, environment: '' }, { json: _json }) as any;
      loop = false;
      return result
    } catch (error) {
      if (error instanceof HTTPError) {
        const { body } = error.response as Response<any>;
        const errors: Record<string, string[]> = JSON.parse(body)
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
                    return chalk.red(errorMsg)
                  }

                  return true
                }
              })

              _json.domain_label = newValue
              break
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
                    return chalk.red(errorMsg)
                  }

                  return true
                }
              })

              _json.name = newValue
              break
            }
            default:
              throw error
          }
        }
      }
    }
  }
}