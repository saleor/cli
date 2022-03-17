import type { Arguments, CommandBuilder } from "yargs";

import Enquirer from "enquirer";
import got from "got";
import { API, GET, POST } from "../../lib/index.js";
import { makeRequestRefreshToken } from "../../lib/util.js";
import { Options } from "../../types.js";
import { interactiveDashboardLogin, interactiveSaleorApp, interactiveWebhook } from "../../middleware/index.js";
import { doWebhookUpdate } from "../../graphql/doWebhookUpdate.js";

export const command = "edit";
export const desc = "Edit a webhook";

export const builder: CommandBuilder = (_) => _

export const handler = async (argv: Arguments<Options>) => {
  const { name, environment, webhookID } = argv;

  console.log(`Editing the webhook for the ${environment} environment`);

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
      query: doWebhookUpdate, 
      variables: {
        id: webhookID,
        input: {
          ...form,
        }
      }
    }
  }).json()

  console.log('webhook updated')

  process.exit(0);
};

export const middlewares = [
  interactiveDashboardLogin,
  interactiveSaleorApp,
  interactiveWebhook,
]