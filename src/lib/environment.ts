import { Arguments } from 'yargs';

import { API, GET } from '../lib/index.js';
import { Environment, Options } from '../types';

// eslint-disable-next-line import/prefer-default-export
export const getEnvironment = async (argv: Arguments<Options>) =>
  GET(API.Environment, argv) as Promise<Environment>;
