import Debug from 'debug';

import { Config } from '../lib/config.js';

const debug = Debug('saleor-cli:logout');

export const command = 'logout';
export const desc = 'Log out from the Saleor Cloud';

export const handler = (): void => {
  debug('resetting the config at `~/.config/saleor.json`');
  Config.reset();
};
