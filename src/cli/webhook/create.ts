import type { Arguments, CommandBuilder } from "yargs";

import chalk from "chalk";
import { emphasize } from "emphasize";
import Enquirer from "enquirer";
import got from "got";
import { API, GET, POST } from "../../lib/index.js";
import { makeRequestRefreshToken } from "../../lib/util.js";
import { Options } from "../../types.js";
import { doWebhookCreate } from "../../graphql/doWebhookCreate.js";
import { interactiveDashboardLogin, interactiveSaleorApp } from "../../middleware/index.js";

export const command = "create";
export const desc = "Create a new backup";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { name, environment, app } = argv;

  console.log(`Creating a webhook for the ${environment} environment`);

  const prompt = new (Enquirer as any).Form({
    name: 'user',
    message: 'Please provide the following information:',
    choices: [
      { name: 'name', message: 'Name' },
      { name: 'targetUrl', message: 'Target URL' },
      { name: 'secretKey', message: 'Secret' }
    ]
  });

  const form = await prompt.run();

  const { domain } = await GET(API.Environment, argv) as any; 

  const token = await makeRequestRefreshToken(domain, argv);

  const { data, errors }: any = await got.post(`https://${domain}/graphql`, {
    headers: {
      'Authorization-Bearer': token,
    },
    json: { 
      query: doWebhookCreate, 
      variables: {
        input: {
          ...form,
          isActive: true,
          app
        }
      }
    }
  }).json()

  console.log('webhook created')

  process.exit(0);
};

export const middlewares = [
  interactiveDashboardLogin,
  interactiveSaleorApp,
]