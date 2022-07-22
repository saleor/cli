import Enquirer from 'enquirer';
import { got, HTTPError, Response } from 'got';

import { validateLength } from './util.js';

const isHttpBasicAuthProtected = (response: Response) => {
  const { body, headers } = response;
  const { 'www-authenticate': authHeader } = headers;

  const auth = (authHeader || '').trim().toLowerCase() === 'basic';
  const unauthorized =
    ((body as string) || '').trim().toLowerCase() === 'unauthorized';

  return auth && unauthorized;
};

const getAuth = async () => {
  console.log('The selected environment is restricted with Basic Auth');
  const data = await Enquirer.prompt<{ username: string; password: string }>([
    // FIXME set initial ??
    {
      type: 'input',
      name: 'username',
      message: 'Username',
      required: true,
      // initial: argv.login || user.email,
      validate: (value: string) => validateLength(value, 128),
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password',
      required: true,
      validate: (value: string) => validateLength(value, 128),
    },
  ]);

  return data;
};

const checkAuth = async (endpoint: string) => {
  try {
    await got.get(endpoint);
    return {};
  } catch (error) {
    if (error instanceof HTTPError) {
      if (isHttpBasicAuthProtected(error.response)) {
        const { username, password } = await getAuth();
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
  json: Record<string, unknown>
) => {
  const auth = await checkAuth(endpoint);

  const { data, errors } = await got
    .post(endpoint, {
      headers: {
        ...headers,
        ...auth,
      },
      json,
    })
    .json();

  // FIXME handle errors

  return data;
};

export default POST;
