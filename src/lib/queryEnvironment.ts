import Enquirer from 'enquirer';
import { got, HTTPError, Response } from 'got';
import { Arguments } from 'yargs';

import { Options, User } from '../types.js';
import { Config } from './config.js';
import { API, GET } from './index.js';
import { validateLength } from './util.js';

const isHttpBasicAuthProtected = (response: Response) => {
  const { body, headers } = response;
  const { 'www-authenticate': authHeader } = headers;

  const auth = (authHeader || '').trim().toLowerCase() === 'basic';
  const unauthorized =
    ((body as string) || '').trim().toLowerCase() === 'unauthorized';

  return auth && unauthorized;
};

const getAuth = async (argv: Arguments<Options>) => {
  console.log('The selected environment is restricted with Basic Auth');
  const { token } = await Config.get();
  const user = (await GET(API.User, { token })) as User;

  const data = await Enquirer.prompt<{ username: string; password: string }>([
    {
      type: 'input',
      name: 'username',
      message: 'Username',
      required: true,
      initial: argv.username || user.email,
      skip: !!argv.username,
      validate: (value: string) => validateLength(value, 128),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
      required: true,
      initial: argv.password,
      skip: !!argv.password,
      validate: (value: string) => validateLength(value, 128),
    },
  ]);

  return data;
};

const checkAuth = async (endpoint: string, argv: Arguments<Options>) => {
  try {
    await got.get(endpoint);
    return {};
  } catch (error) {
    if (error instanceof HTTPError) {
      if (isHttpBasicAuthProtected(error.response)) {
        const { username, password } = await getAuth(argv);
        const encodedAuth = btoa(`${username}:${password}`);
        return { Authorization: `Basic ${encodedAuth}` };
      }
      throw error;
    } else {
      throw error;
    }
  }
};

export const POST = async (
  endpoint: string,
  headers: Record<string, string>,
  json: Record<string, unknown>,
  argv: Arguments<Options>
) => {
  const auth = await checkAuth(endpoint, argv);

  const { data } = await got
    .post(endpoint, {
      headers: {
        ...headers,
        ...auth,
      },
      json,
    })
    .json<{ data: unknown; errors: Error[] }>();

  // FIXME handle errors

  return data;
};

export default POST;
