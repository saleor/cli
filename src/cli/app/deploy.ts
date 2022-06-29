import got from "got";
import path from "path";
import fs from "fs-extra";
import dotenv from "dotenv"
import { simpleGit } from 'simple-git';
import type { Arguments, CommandBuilder } from "yargs";
import { Config } from "../../lib/config.js";
import { Options } from "../../types.js";
import Enquirer from "enquirer";
import chalk from "chalk";
import { delay } from "../../lib/util.js";
import ora from "ora";

export const command = "deploy";
export const desc = "Deploy this Saleor App repository to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { vercel_token, vercel_team_id, github_token: GitHubToken } = await Config.get()
  const git = simpleGit();

  const { name } = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf-8'));
  console.log(`\nDeploying... ${chalk.cyan(name)} (the name inferred from ${chalk.yellow('package.json')})`);

  const remotes = await git.getRemotes(true);
  const isGitHub = remotes.some(el => el.name === 'origin' && el.refs.push.includes('github'))

  let repoId

  if (!isGitHub) {
    const { githubProjectCreate } = await Enquirer.prompt({
      type: 'confirm',
      name: 'githubProjectCreate',
      initial: 'yes',
      format: (value) => chalk.cyan(value ? 'yes' : 'no'),
      message: 'Creating a project on your GitHub. Do you want to continue?'
    }) as { githubProjectCreate: boolean }

    if (!githubProjectCreate) {
      console.error('Saleor App deployment cancelled by the user')
      process.exit(1);
    }

    const { data, errors } = await got.post(`https://api.github.com/graphql`, {
      headers: {
        Authorization: GitHubToken,
      },
      json: {
        query: `mutation doRepositoryCreate($name: String!) {
        createRepository(input: {name: $name, visibility: PRIVATE }) {
          repository {
            id
            url
            sshUrl
          }
        }
      }`,
        variables: { name }
      }
    }).json()

    if (errors) {
      for (const error of errors) {
        if (error.message === 'Name already exists on this account') {
          console.log(`Pushing to the existing repository '${name}'`)

          const { data, errors } = await got.post(`https://api.github.com/graphql`, {
            headers: { Authorization: GitHubToken },
            json: {
              query: `query getRepository($name: String!) {
                viewer {
                  repository(name: $name) {
                    id
                    url
                    sshUrl
                  }
                }
              }`,
              variables: { name }
            }
          }).json()

          const { viewer: { repository: { id, sshUrl } } } = data;
          repoId = id;
          await git.addRemote('origin', sshUrl);
        } else {
          console.error(`\n ${chalk.red('ERROR')} ${error.message}`);
        }
      }
    } else {
      const { createRepository: { repository: { sshUrl, id } } } = data;
      repoId = id;
      await git.addRemote('origin', sshUrl);
    }
  }

  // 2. Create a project in Vercel
  const envs = dotenv.parse(await fs.readFile(path.join(process.cwd(), '.env')));
  const environmentVariables = Object.entries(envs).map(([key, value]) => ({ key, value, target: ["production", "preview", "development"], type: 'plain' }))

  const output = Object.entries(envs).map(([key, value]) => `${chalk.dim(key)}=${chalk.cyan(value)}`).join('\n')

  console.log("\n--- Setting the environment variables from `.env` in Vercel")
  console.log(output);

  if (!vercel_team_id && !vercel_token) {
    console.error(`Error: You must be logged to Vercel - use 'saleor vercel login'`);
  } else {
    console.log("\nDeploying to Vercel")

    const { data: { viewer: { login } } } = await got.post(`https://api.github.com/graphql`, {
      headers: { Authorization: GitHubToken },
      json: {
        query: `{ viewer { login } }`
      }
    }).json();

    let projectID;

    try {
      const { id }: any = await got.get(`https://api.vercel.com/v9/projects/${name}`, {
        headers: {
          Authorization: vercel_token
        }
      }).json()

      projectID = id;
    } catch (error) {
      // TODO check if `ERR_NON_2XX_3XX_RESPONSE` for `error.code`
      const { id } = await got.post(`https://api.vercel.com/v9/projects`, {
        headers: {
          Authorization: vercel_token,
        },
        json: {
          name,
          environmentVariables,
          gitRepository: {
            type: "github",
            repo: `${login}/${name}`
          }
        },
      }).json();

      projectID = id;
    }

    // 3. Push to GitHub
    await git.push('origin', 'main', { '-f': null });

    const spinner = ora("Registering the changes in Vercel...").start();
    await delay(5000);
    spinner.succeed('Done')

    const { deployments } = await got.get(`https://api.vercel.com/v6/deployments?projectId=${projectID}`, {
      headers: {
        Authorization: vercel_token
      }
    }).json()

    if (deployments.length > 0) {
      const { url } = deployments[0];
      console.log(`\nYour Vercel URL: https://${url}`)
    }
  }

  process.exit(0);
};

export const middlewares = [
  //
]