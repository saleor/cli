import { Arguments } from 'yargs';

import Enquirer from 'enquirer';
import { API, GET } from '../lib/index.js';
import { Environment, Options } from '../types.js';
import { validateURL } from './util.js';

export const getEnvironment = async (argv: Arguments<Options>) =>
  GET(API.Environment, argv) as Promise<Environment>;

export const promptOrigin = async () => {
  const form = await Enquirer.prompt<{
    origin: string;
    addMore: boolean;
  }>([
    {
      type: 'input',
      name: 'origin',
      message: 'Origin',
      validate: (value) => validateURL(value),
    },
    {
      type: 'confirm',
      name: 'addMore',
      message: 'Add another one?',
    },
  ]);

  return {
    origin: new URL(form.origin).origin,
    addMore: form.addMore,
  };
};
