import ora from 'ora';

import { API, GET } from '../lib/index.js';
import { Environment, Options, Organization } from '../types.js';

export const validateInstance = (instance: string) => {
  try {
    const { protocol, host } = new URL(instance);
    return `${protocol}//${host}`;
  } catch (error) {
    throw new Error('Provided URL is invalid');
  }
};

export const extractDataFromInstance = async (argv: Options) => {
  const spinner = ora('Getting instance details...').start();
  const { instance } = argv;

  const match = instance?.match(/(?:http[s]*:\/\/)*(.*?)\.(?=[^/]*\..{2,5})/i);

  if (!match) {
    spinner.fail();
    throw new Error('The environment not found');
  }

  const envName = match[1];

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

      if (environments.map((e) => e.name).includes(envName)) {
        const environment = environments.filter((e) => e.name === envName)[0];

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
