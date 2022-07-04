import Enquirer from 'enquirer';
import got from 'got';
import ora from 'ora';
import { Arguments } from 'yargs';

import { doWebhookUpdate } from '../../graphql/doWebhookUpdate.js';
import { WebhookList } from '../../graphql/WebhookList.js';
import { Config } from '../../lib/config.js';
import { API, GET } from '../../lib/index.js';
import { getAppsFromResult } from '../../lib/util.js';
import { Options } from '../../types.js';

export const command = 'update';
export const desc = 'Update webhooks for an environment';

export const handler = async (argv: Arguments<Options>) => {
  const { domain } = (await GET(API.Environment, argv)) as any;
  await updateWebhook(domain);
};

export const updateWebhook = async (domain: string) => {
  const gqlUrl = `https://${domain}/graphql`;
  const headers = await Config.getBearerHeader();

  const { data }: any = await got
    .post(gqlUrl, {
      headers,
      json: {
        query: WebhookList,
      },
    })
    .json();

  const apps = getAppsFromResult(data);

  const { updateAll } = await Enquirer.prompt<{ updateAll: string }>({
    type: 'confirm',
    name: 'updateAll',
    message: 'Would you like to replace domain for all webhooks targetUrl',
  });

  if (updateAll) {
    const { webhooksDomain } = await Enquirer.prompt<{
      webhooksDomain: string;
    }>({
      type: 'input',
      name: 'webhooksDomain',
      message: 'Domain',
      initial: 'http://localhost:3000',
    });

    const spinner = ora('Updating...').start();

    for (const {
      node: { webhooks },
    } of apps) {
      for (const { id, targetUrl } of webhooks) {
        const url = new URL(targetUrl);
        const newTargetUrl = `${webhooksDomain}${url.pathname}`;
        await runUpdateWebhook(headers, gqlUrl, id, newTargetUrl);
      }
    }

    spinner.succeed('Yay! Webhooks updated');
  } else {
    for (const {
      node: { webhooks, name: appName },
    } of apps) {
      for (const { id, targetUrl, name } of webhooks) {
        const { newTargetUrl } = await Enquirer.prompt<{
          newTargetUrl: string;
        }>({
          type: 'input',
          name: 'newTargetUrl',
          message: `App: ${appName}, webhook: ${name} - ${targetUrl}`,
          initial: targetUrl,
        });

        const spinner = ora('Updating...').start();
        await runUpdateWebhook(headers, gqlUrl, id, newTargetUrl);
        spinner.succeed('Updated');
      }
    }
  }
};

const runUpdateWebhook = async (
  headers: Record<string, string>,
  gqlUrl: string,
  id: string,
  targetUrl: string | null
) => {
  const { errors }: any = await got
    .post(gqlUrl, {
      headers,
      json: {
        query: doWebhookUpdate,
        variables: {
          input: {
            targetUrl,
          },
          id,
        },
      },
    })
    .json();

  if (errors) {
    throw Error('cannot auth');
  }
};
