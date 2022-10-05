import { rest } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  assert,
  beforeAll,
  describe,
  expect,
  it,
} from 'vitest';

import { Vercel } from '../src/lib/vercel.js';

const VercelURL = 'https://api.vercel.com';

const myProject1 = {
  name: 'my-project-1',
  slug: 'my-project-1',
};

const handlers = [
  rest.get('https://rest.example/path/to/posts', (req, res, ctx) =>
    res(ctx.status(200), ctx.json(myProject1))
  ),
  rest.get(`${VercelURL}/v9/projects/my-project-1`, (req, res, ctx) =>
    res(ctx.status(200), ctx.json(myProject1))
  ),
  rest.get(`${VercelURL}/v13/deployments/xxx`, (req, res, ctx) =>
    res(ctx.status(200), ctx.json([]))
  ),
];

const server = setupServer(...handlers);
server.printHandlers();

const vercel = new Vercel('asdf');

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('Vercel API', () => {
  it('returns `id` for single project', async () => {
    const r = await vercel.getProject('my-project-1');

    expect(r).toEqual({ name: 'my-project-1', slug: 'my-project-1' });
  });

  it('foo', () => {
    assert.equal(Math.sqrt(4), 2);
  });

  it('bar', () => {
    expect(1 + 1).eq(2);
  });

  it('snapshot', () => {
    expect({ foo: 'bar' }).toMatchSnapshot();
  });
});
