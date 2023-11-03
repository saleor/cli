import Debug from 'debug';
import { Arguments, CommandBuilder } from 'yargs';

import { doSaleorAppInstall } from '../../lib/common.js';
import { obfuscateArgv, printContext } from '../../lib/util.js';
import {
  useAppConfig,
  useAvailabilityChecker,
  useInstanceConnector,
} from '../../middleware/index.js';
import { Options } from '../../types.js';

const debug = Debug('saleor-cli:app:install');

export const command = 'install';
export const desc = 'Install a Saleor App by URL';

export const builder: CommandBuilder = (_) =>
  _.option('via-dashboard', {
    type: 'boolean',
    default: false,
  })
    .option('app-name', {
      demandOption: false,
      type: 'string',
      desc: 'Application name',
    })
    .option('manifest-URL', {
      demandOption: false,
      type: 'string',
      desc: 'Application Manifest URL',
    })
    .example(
      'saleor app install --manifest-URL="https://my-saleor-app.com/api/manifest',
      '',
    )
    .example(
      'saleor app install --manifest-URL="https://my-saleor-app.com/api/manifest --app-name="Saleor app"',
      '',
    )
    .example(
      'saleor app install --organization="organization-slug" --environment="env-id-or-name" --app-name="Saleor app" --manifest-URL="https://my-saleor-app.com/api/manifest"',
      '',
    );

export const handler = async (argv: Arguments<Options>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  printContext(argv);

  await doSaleorAppInstall(argv);

  process.exit(0);
};

export const middlewares = [
  useAppConfig,
  useInstanceConnector,
  useAvailabilityChecker,
];
