import boxen from "boxen";
import chalk from "chalk";
import got from "got";
import type { Arguments, CommandBuilder } from "yargs";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import { deploy } from "../../lib/util.js"
import { useEnvironment } from "../../middleware/index.js";
import { Options } from "../../types.js";
import { deployVercelProject, getDeployment, verifyDeployment } from "../checkout/deploy.js";

export const command = "deploy <name>";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options & { name: string }>) => {
  const { name } = argv;
  const { domain } = await GET(API.Environment, argv) as any;
  const url = `https://${domain}/graphql/`;

  const { vercel_token: vercelToken, vercel_team_id } = await Config.get();

  if (!vercel_team_id && !vercelToken) {
    await deploy({ name, url });

    console.log(chalk("\n👋 Run", chalk.bold.yellowBright("saleor vercel login"), "to integrate Saleor CLI with Vercel and automate deployment"))
  } else {
    await createStorefront(url, name, vercelToken);
    const appDeploymentId = await deployVercelProject(vercelToken, name, 398326371);
    await verifyDeployment(vercelToken, name, appDeploymentId)
    const { alias } = await getDeployment(vercelToken, appDeploymentId);
    const summary = `${name} Vercel domain: ${alias[0]}`

    console.log(boxen(summary, {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: "yellow",
    }));
  }
};

const createStorefront = async (url: string, name: string, vercelToken: string, repo = 'react-storefront') => {
  const response = await got.post(`https://api.vercel.com/v8/projects`, {
    headers: {
      Authorization: vercelToken,
    },
    json: {
      name,
      framework: "nextjs",
      environmentVariables: [
        {
          key: "NEXT_PUBLIC_API_URI",
          value: url,
          target: ["production", "preview", "development"],
          type: "encrypted"
        },
      ],
      gitRepository: {
        type: "github",
        repo,
        sourceless: true
      }
    },
  }).json();

  return response
}

export const middlewares = [
  useEnvironment
]