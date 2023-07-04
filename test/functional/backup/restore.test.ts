import stripAnsi from 'strip-ansi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  command,
  DefaultTriggerResponse,
  prepareEnvironment,
  testEnvironmentName,
  testOrganization,
  trigger,
} from '../../helper';

const backupName = `${testEnvironmentName}-backup`;
let backupKey = '';

beforeAll(async () => {
  await prepareEnvironment();
  const params = [
    'backup',
    'create',
    backupName,
    `--environment=${testEnvironmentName}`,
    `--organization=${testOrganization}`,
    '--json',
  ];
  console.log(`creating backup ${backupName}`);
  const { output } = await trigger(
    command,
    params,
    {},
    {
      ...DefaultTriggerResponse,
      ...{ output: ['{"key": "key"}'] },
    }
  );
  const { key } = JSON.parse(stripAnsi(output.join('')));
  backupKey = key;
  console.log(`backup created ${key}`);
}, 1000 * 60 * 10);

afterAll(async () => {
  await removeBackups();
}, 1000 * 60 * 10);

describe('backup restore', async () => {
  it(
    'should restore a backup',
    async () => {
      const params = [
        'backup',
        'restore',
        backupKey,
        '--skip-webhooks-update',
        `--environment=${testEnvironmentName}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode, err } = await trigger(
        command,
        params,
        {},
        {
          ...DefaultTriggerResponse,
          ...{ err: ['Yay! Restore finished!'] },
        }
      );

      expect(exitCode).toBe(0);
      expect(err.join()).toContain('Yay! Restore finished!');
    },
    1000 * 60 * 10
  );
});

const getBackups = async () => {
  const params = [
    'backup',
    'list',
    `--environment=${testEnvironmentName}`,
    `--organization=${testOrganization}`,
    '--json',
  ];

  const { output } = await trigger(
    command,
    params,
    {},
    {
      ...DefaultTriggerResponse,
      ...{ output: ['[]'] },
    }
  );
  return JSON.parse(output.join(''));
};

const removeBackups = async () => {
  const backups = await getBackups();

  for (const backup of backups) {
    const params = [
      'backup',
      'remove',
      backup.key,
      `--environment=${testEnvironmentName}`,
      `--organization=${testOrganization}`,
      '--force',
    ];

    console.log(`removing backup ${backup.key} - ${backup.name}`);
    await trigger(command, params, {});
  }
};
