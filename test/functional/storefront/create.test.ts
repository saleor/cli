import crypto from 'crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { capitalize } from '../../../src/lib/util.js';
import { command, testOrganization, trigger } from '../../helper';

const rand = crypto.randomBytes(256).toString('hex').substring(0, 7);
const storefrontName = `storefront-${rand}`;
const storefrontCwd = `${process.cwd()}/${storefrontName}`;

// beforeAll(async () => {
//   const environment = await prepareEnvironment();

//   const params = [
//     'store',
//     'create',
//     storefrontName,
//     `--environment=${environment}`,
//   ];
//   console.log(
//     `creating storefront ${storefrontName} with the ${environment} env`
//   );
//   await trigger(command, params, {});
// }, 1000 * 60 * 10);

afterAll(async () => {
  //   await fs.remove(storefrontCwd);
  //   await trigger(command, ['env', 'remove', storefrontName], {}, 0);
  //   await trigger(command, ['project', 'remove', 'saleor-demo'], {}, 0);
}, 1000 * 60 * 10);

describe('storefront create --demo', async () => {
  it(
    'should create a demo storefront',
    async () => {
      const params = [
        'storefront',
        'create',
        storefrontName,
        '--demo',
        `--organization=${testOrganization}`,
      ];
      const { exitCode, output } = await trigger(command, params, {}, 0);
      // const pkg = await fs.readFile(path.join(storefrontCwd, 'package.json'));

      expect(exitCode).toBe(0);
      expect(output.join()).toContain(storefrontName);
      //  expect(pkg.toString()).toContain(storefrontName);
    },
    1000 * 60 * 10
  );
  it(
    'should create a demo project',
    async () => {
      const params = ['project', 'list', `--organization=${testOrganization}`];

      const { exitCode, output } = await trigger(command, params, {}, 0);
      expect(exitCode).toBe(0);
      expect(output.join()).toContain('Saleor-demo');
    },
    1000 * 60 * 1
  );

  it(
    'should create a demo environment',
    async () => {
      const demoName = capitalize(storefrontName);
      const params = [
        'enviroment',
        'list',
        `--organization=${testOrganization}`,
      ];

      const { exitCode, output } = await trigger(command, params, {}, 0);
      expect(exitCode).toBe(0);
      expect(output.join()).toContain(demoName);
    },
    1000 * 60 * 1
  );
});
