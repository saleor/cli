import Debug from 'debug';
import type { CommandBuilder } from 'yargs';
import { Arguments } from 'yargs';
import { CommandRemovedError, obfuscateArgv } from '../../lib/util.js';
import { Deploy } from '../../types.js';

const debug = Debug('saleor-cli:storefront:deploy');

export const command = 'deploy';
export const desc = false;
// export const desc = 'Deploy this `react-storefront` to Vercel';

export const builder: CommandBuilder = (_) =>
  _.option('dispatch', {
    type: 'boolean',
    demandOption: false,
    default: false,
    desc: 'dispatch deployment and don\'t wait till it ends',
  })
    .option('github-prompt', {
      type: 'boolean',
      default: 'true',
      demandOption: false,
      desc: 'specify prompt presence for repository creation on Github',
    })
    .example('saleor storefront deploy --no-github-prompt', '')
    .example(
      'saleor storefront deploy --organization=organization-slug --environment=env-id-or-name --no-github-prompt',
      '',
    );

export const handler = async (argv: Arguments<Deploy>) => {
  debug('command arguments: %O', obfuscateArgv(argv));

  throw new CommandRemovedError(
    'This command has been removed\nPlease check documentation for `storefront` commands at https://github.com/saleor/saleor-cli/tree/main/docs',
  );
};
