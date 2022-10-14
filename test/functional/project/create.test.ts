import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  clearProjects,
  command,
  currentDate,
  DefaultTriggerResponse,
  removeProject,
  testOrganization,
  trigger,
} from '../../helper';

const projectName = `test-project-${currentDate()}`;

beforeAll(async () => {
  await clearProjects();
});

afterAll(async () => {
  await removeProject(projectName);
});

describe('create new project', async () => {
  const region = 'us-east-1';
  it(
    'creates a new project',
    async () => {
      const params = [
        'project',
        'create',
        projectName,
        '--plan=dev',
        `--region=${region}`,
        `--organization=${testOrganization}`,
      ];
      const { exitCode } = await trigger(command, params, {});
      expect(exitCode).toBe(0);
    },
    1000 * 60 * 1
  );

  it(
    'shows project list',
    async () => {
      const params = ['project', 'list', `--organization=${testOrganization}`];

      const { exitCode, output } = await trigger(
        command,
        params,
        {},
        {
          ...DefaultTriggerResponse,
          ...{
            output: [projectName],
          },
        }
      );
      expect(exitCode).toBe(0);
      expect(output.join()).toContain(projectName);
    },
    1000 * 60 * 1
  );

  it('shows project details', async () => {
    const params = [
      'project',
      'show',
      projectName,
      `--organization=${testOrganization}`,
    ];

    const { exitCode, output } = await trigger(
      command,
      params,
      {},
      {
        ...DefaultTriggerResponse,
        ...{
          output: [
            `name: ${projectName}`,
            `slug: ${projectName}`,
            `region: ${region}`,
          ],
        },
      }
    );
    expect(exitCode).toBe(0);
    expect(output.join()).toContain(`name: ${projectName}`);
    expect(output.join()).toContain(`slug: ${projectName}`);
    expect(output.join()).toContain(`region: ${region}`);
  });
});
