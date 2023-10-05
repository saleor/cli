import ora from 'ora';
import { print } from 'graphql';
import { got } from 'got';

import { API, GET } from '../lib/index.js';
import { Environment, Options, Organization } from '../types.js';
import { Introspection } from '../generated/graphql.js';

export const validateInstance = async (instance: string) => {
  try {
    // verify if instance is a valid URL
    const { href } = new URL(instance);
    const instanceURL = href;

    // verify if instance is a valid GraphQL endpoint
    await got
      .post(instanceURL, {
        json: {
          query: print(Introspection),
        },
      })
      .json();

    return instanceURL;
  } catch (error) {
    throw new Error('Provided URL is not a valid GraphQL endpoint');
  }
};

export const extractDataFromInstance = async (argv: Options) => {
  const spinner = ora('Getting instance details...').start();
  const { instance } = argv;

  const { host } = new URL(instance ?? '');

  const organizations = (await GET(API.Organization, {
    ...argv,
    organization: '',
  })) as Organization[];

  for (const organization of organizations) {
    try {
      const environments = (await GET(API.Environment, {
        ...argv,
        organization: organization.slug,
        environment: '',
      })) as Environment[];

      if (environments.map((e) => e.domain).includes(host)) {
        const environment = environments.filter((e) => e.domain === host)[0];

        spinner.succeed();
        return {
          organization: organization.slug,
          environment: environment.key,
        };
      }
    } catch (error) {
      spinner.fail();
      throw new Error('There was a problem while fetching environment');
    }
  }

  spinner.fail();
  throw new Error('The environment not found in the Saleor Cloud');
};
