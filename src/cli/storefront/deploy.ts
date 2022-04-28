import got from "got";
import type { Arguments, CommandBuilder } from "yargs";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import { deploy } from "../../lib/util.js"
import { useEnvironment } from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "deploy [name]";
export const desc = "Deploy `react-storefront` to Vercel";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options & { name: string }>) => {
  const { name } = argv;
  const { domain } = await GET(API.Environment, argv) as any;
  const url = `https://${domain}/graphql/`;

  const { vercel_token, vercel_team_id } = await Config.get()

  if (!vercel_team_id && !vercel_token) {
    await deploy({ name, url });
  } else {
    console.log("Using Vercel API")
    console.log(name)

    const data: any = await got.post(`https://api.vercel.com/v8/projects`, {
      headers: {
        Authorization: vercel_token,
      },
      json: {
        name,
        environmentVariables: [
          { key: "NEXT_PUBLIC_API_URI", value: url, target: "production", type: "plain" }
        ],
        gitRepository: {
          type: "github",
          repo: "saleor/react-storefront"
        }
      },
    }).json();
  }

  process.exit(0);
};


export const middlewares = [
  useEnvironment
]