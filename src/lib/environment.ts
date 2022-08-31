import { Arguments } from 'yargs';

import { API, GET } from '../lib/index.js';
import { Environment, Options } from '../types';

export const getEnvironment = async (argv: Arguments<Options>) =>
  GET(API.Environment, argv) as Promise<Environment>;

export const getEnvironmentGraphqlEndpoint = async (
  argv: Arguments<Options>
) => {
  const { domain } = await getEnvironment(argv);

  return `https://${domain}/graphql/`;
};
