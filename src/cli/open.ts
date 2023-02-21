import Enquirer from 'enquirer';
import { Arguments, CommandBuilder } from 'yargs';

import { openURL } from '../lib/util.js';
import { useInstanceConnector } from '../middleware/index.js';
import { Options } from '../types.js';

export const command = 'open [resource]';
export const desc = 'Open resource in browser';

const resources: Record<string, string> = {
  dashboard: '/dashboard',
  api: '/graphql/',
  docs: 'https://docs.saleor.io/docs/3.x/',
  'docs/api': 'https://docs.saleor.io/docs/3.x/developer',
  'docs/apps':
    'https://docs.saleor.io/docs/3.x/developer/extending/apps/key-concepts',
  'docs/webhooks':
    'https://docs.saleor.io/docs/3.x/developer/extending/apps/asynchronous-webhooks',
  'docs/checkout':
    'https://github.com/saleor/react-storefront/blob/canary/apps/saleor-app-checkout/README.md',
  'docs/storefront': 'https://github.com/saleor/react-storefront',
  'docs/cli': 'https://docs.saleor.io/docs/3.x/cli',
};

export const builder: CommandBuilder = (_) =>
  _.positional('resource', {
    type: 'string',
    demandOption: true,
    choices: Object.keys(resources),
  })
    .example('saleor open dashboard', 'Open instance dashboard')
    .example('saleor open api', 'Open instance GraphQL endpoint')
    .example('saleor open docs', 'Open Saleor documentation page');

export const handler = async (argv: Arguments<Options>) => {
  const choices = Object.keys(resources);

  const { resource } = await Enquirer.prompt<{ resource: string }>({
    type: 'select',
    name: 'resource',
    choices,
    message: 'Choose the resource',
    skip: choices.includes(argv.resource as string),
  });

  const path = resources[resource || (argv.resource as string)];

  if (!path.startsWith('https')) {
    const url = await getURL(path, argv);
    await openURL(url);
    return;
  }

  await openURL(path);
};

const getURL = async (path: string, argv: Arguments<Options>) => {
  const _argv = await useInstanceConnector(argv);
  const { instance } = _argv;
  return `${instance}${path}`;
};
