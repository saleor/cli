// FIXME
/* eslint-disable no-case-declarations */
import Debug from 'debug';
import Enquirer from 'enquirer';
import fs from 'fs-extra';
import { request } from 'graphql-request';
import path, { dirname } from 'path';
import { render } from 'tplv';
import { fileURLToPath } from 'url';
import { Arguments, CommandBuilder } from 'yargs';

import { GetWebhookEventEnum } from '../../generated/graphql.js';
import { verifyIsSaleorAppDirectory } from '../../lib/common.js';
import { DefaultSaleorEndpoint } from '../../lib/index.js';
import {
  capitalize,
  obfuscateArgv,
  uncapitalize,
  without,
} from '../../lib/util.js';
import { Options } from '../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const debug = Debug('saleor-cli:app:generate');

export const command = 'generate <resource>';
export const desc = 'Generate a resource for a Saleor App';

export const builder: CommandBuilder = (_) =>
  _.positional('resource', {
    type: 'string',
    demandOption: true,
    choices: ['webhook', 'query', 'mutation', 'subscription'],
  });

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  const { resource } = argv;

  switch (resource) {
    case 'webhook':
      debug(`Getting enum values from Saleor API: ${DefaultSaleorEndpoint}`);
      const {
        __type: { enumValues },
      } = await request(DefaultSaleorEndpoint, GetWebhookEventEnum);
      const choices = enumValues.filter(without('ANY_EVENTS'));

      const prompt = new (Enquirer as any).AutoComplete({
        name: 'event',
        message: 'Select a web hook event (start typing)',
        limit: 10,
        choices,
      });

      const form: string = await prompt.run();

      debug('Converting the event name to file name');
      const webhookName = form.toLowerCase().replaceAll('_', '-');
      const camelcaseName = webhookName.split('-').map(capitalize).join('');

      const appWebhookPath = path.join(
        'pages',
        'api',
        'webhooks',
        `${webhookName}.ts`
      );
      const webhookPath = path.join(process.cwd(), appWebhookPath);
      const rootPath = path.resolve(__dirname, '..', '..', '..');
      const webhookHandlerFn = await fs.readFile(
        path.join(rootPath, 'template', 'webhook-handler.ts'),
        'utf-8'
      );
      await fs.outputFile(webhookPath, webhookHandlerFn);

      console.log(
        `\nGenerated a webhook handler for the '${form}' event in '${appWebhookPath}'`
      );

      const subscriptionPath = path.join(
        process.cwd(),
        'graphql',
        'subscriptions',
        `${camelcaseName}Subscription.graphql`
      );
      const subscriptionTemplatePath = path.join(
        rootPath,
        'template',
        'event-subscription.graphql'
      );
      const subscriptionTemplate = await fs.readFile(
        subscriptionTemplatePath,
        'utf-8'
      );

      const operationName = uncapitalize(
        webhookName.split('-').slice(0, -1).map(capitalize).join('')
      );
      const subscriptionCompiledTemplate = render(subscriptionTemplate, {
        name: camelcaseName,
        operationName,
      });
      await fs.outputFile(subscriptionPath, subscriptionCompiledTemplate);

      break;
    default:
      break;
  }

  process.exit(0);
};

export const middlewares = [verifyIsSaleorAppDirectory];
