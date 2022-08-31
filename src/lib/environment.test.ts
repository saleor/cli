/* eslint-disable import/no-extraneous-dependencies */
import { rest } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Arguments } from 'yargs';

import { Options } from '../types';
import { getEnvironment, getEnvironmentGraphqlEndpoint } from './environment';
import { configs } from './index';

const CloudApiUrl = configs.staging.cloudApiUrl;

const environment = {
  name: 'Test environment',
  slug: 'test-environment',
  domain: 'test-environment.test.saleor.cloud',
};

const argv = {
  _: ['test'],
  $0: 'saleor',
  token: 'XYZ',
  organization: 'test_org',
  environment: 'test',
} as Arguments<Options>;

const handlers = [
  rest.get('https://rest.example/path/to/posts', (req, res, ctx) =>
    res(ctx.status(200), ctx.json(environment))
  ),
  rest.get(
    `${CloudApiUrl}/organizations/${argv.organization}/environments/${argv.environment}`,
    (req, res, ctx) => res(ctx.status(200), ctx.json(environment))
  ),
];

const server = setupServer(...handlers);
server.printHandlers();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('getEnvironment', () => {
  it('should return the environment object from the Cloud API', async () => {
    const response = await getEnvironment(argv);

    expect(response).toEqual(environment);
  });
});

describe('getEnvironmentGraphqlEndpoint', () => {
  it('should return the environment\'s graphql endpoint', async () => {
    const response = await getEnvironmentGraphqlEndpoint(argv);

    expect(response).toEqual(
      'https://test-environment.test.saleor.cloud/graphql/'
    );
  });
});
