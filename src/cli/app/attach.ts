import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import { Arguments, CommandBuilder } from 'yargs';

import { getEnvironment } from '../../lib/environment.js';
import {
  useEnvironment,
  useOrganization,
  useToken,
} from '../../middleware/index.js';
import { AppAttachOptions } from '../../types.js';

export const command = 'attach';
export const desc = 'Attach a Saleor App to the Saleor environment';

export const builder: CommandBuilder = (_) =>
  _.option('name', {
    type: 'string',
    default: 'NEXT_PUBLIC_SALEOR_HOST_URL',
    desc: 'Environment variable name',
  }).option('value', {
    type: 'string',
    desc: 'Environment variable value',
  });

export const handler = async (argv: Arguments<AppAttachOptions>) => {
  const { name, value } = argv;

  const { domain } = await getEnvironment(argv);
  const endpoint = `https://${domain}`;

  let file;
  try {
    file = await fs.readFile(path.join(process.cwd(), '.env'));
  } catch {
    file = '';
  }
  const envs = dotenv.parse(file);
  envs[name] = value || endpoint;

  await fs.writeFile(
    path.join(process.cwd(), '.env'),
    Object.entries(envs)
      .map(([key, _value]) => `${key}=${_value}`)
      .join('\n')
  );
};

export const middlewares = [useToken, useOrganization, useEnvironment];
