import { describe, expect, it } from 'vitest';

import { clearProjects, listProjects } from './helper';

describe('Clean test account on cloud', async () => {
  it(
    'should remove all projects',
    async () => {
      console.log('removing all projects');
      await clearProjects(true);
    },
    1000 * 60 * 5,
  );

  it('should return 0 projects', async () => {
    const { output } = await listProjects();
    const projects: [] = JSON.parse(output.join());
    expect(projects.length).toBe(0);
  });
});
