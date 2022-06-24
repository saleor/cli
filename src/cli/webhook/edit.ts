import Enquirer from "enquirer";
import got from "got";
import type { Arguments, CommandBuilder } from "yargs";

import { doWebhookUpdate } from "../../graphql/doWebhookUpdate.js";
import { Config } from "../../lib/config.js";
import { API, GET } from "../../lib/index.js";
import {
  interactiveSaleorApp,
  interactiveWebhook,
} from "../../middleware/index.js";
import { Options } from "../../types.js";

export const command = "edit";
export const desc = "Edit a webhook";

export const builder: CommandBuilder = (_) => _;

export const handler = async (argv: Arguments<Options>) => {
  const { environment, webhookID } = argv;

  console.log(`Editing the webhook for the ${environment} environment`);

  const prompt = new (Enquirer as any).Form({
    name: "user",
    message: "Please provide the following information:",
    choices: [
      { name: "name", message: "Name" },
      { name: "targetUrl", message: "Target URL" },
      { name: "secretKey", message: "Secret" },
    ],
  });

  const result = await prompt.run();

  const form = Object.fromEntries(Object.entries(result).filter(([_, v]) => v));

  const { domain } = (await GET(API.Environment, argv)) as any;
  const headers = await Config.getBearerHeader();

  const { data, errors }: any = await got
    .post(`https://${domain}/graphql`, {
      headers,
      json: {
        query: doWebhookUpdate,
        variables: {
          id: webhookID,
          input: {
            ...form,
          },
        },
      },
    })
    .json();

  console.log("webhook updated");

  process.exit(0);
};

export const middlewares = [interactiveSaleorApp, interactiveWebhook];
