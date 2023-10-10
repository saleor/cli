import { spawn } from 'child_process';
import GitUrlParse from 'git-url-parse';
import got from 'got';

import { Config } from '../src/lib/config.js';
import { API, GET, PATCH } from '../src/lib/index.js';
import { Environment } from '../src/types.js';
import { delay } from '../src/lib/util.js';

export const currentDate = () => Date.now().toString();

export const shouldMockTests = !process.env.RUN_FUNCTIONAL_TESTS;
export const command = 'node';
export const buildPath = `${process.env.PWD}/dist/saleor.js`;
export const testOrganization = 'devtools';
export const testEnvironmentName = 'saleor-test';
export const newTestEnvironmentName = 'updated-name';
export const testProjectName = 'cli-test';
export const region = 'us-east-1';
interface DefaultTriggerResponse {
  output: string[];
  err: string[];
  exitCode: number;
}

export const DefaultTriggerResponse = <DefaultTriggerResponse>{
  output: [],
  err: [],
  exitCode: 0,
};

export const trigger = async (
  cmd: string,
  params: string[],
  options: {},
  defaults = DefaultTriggerResponse,
) => {
  if (shouldMockTests) {
    return defaults;
  }

  const child = spawn(command, [...[buildPath], ...params], options);

  const output: string[] = [];
  for await (const data of child.stdout || []) {
    output.push(data.toString());
  }

  const err: string[] = [];
  for await (const data of child.stderr || []) {
    err.push(data.toString());
  }

  const exitCode = await new Promise((resolve, _) => {
    child.on('close', resolve);
  });

  if (err.length > 0) {
    console.log(params.join(' '));
    console.log(err);
  }

  return {
    output,
    err,
    exitCode,
  };
};

export const getEnvironmentId = async (
  organization = testOrganization,
  environmentName = testEnvironmentName,
) => {
  const params = [
    'env',
    'show',
    environmentName,
    `--organization=${organization}`,
    '--json',
  ];
  const { output } = await trigger(command, params, {});
  const { key } = <{ key: string }>(
    JSON.parse(output.length > 0 ? output.join() : '{}')
  );

  return key;
};

export const verifyTestProjectPresence = async (
  organization = testOrganization,
  project = testProjectName,
) => {
  const params = ['project', 'list', `--organization=${organization}`];

  const { err, output, exitCode } = await trigger(command, params, {});

  if (output.join('').includes(` ${project} `)) {
    console.log('Project exists');
    return true;
  }

  if (exitCode !== 0) {
    throw new Error(err.join());
  }

  return false;
};

export const createTestProject = async (organization = testOrganization) => {
  const projectExists = await verifyTestProjectPresence();

  if (!projectExists) {
    const params = [
      'project',
      'create',
      testProjectName,
      '--plan=dev',
      `--region=${region}`,
      `--organization=${organization}`,
    ];

    const { err, exitCode } = await trigger(command, params, {});
    if (exitCode !== 0) {
      throw new Error(err.join());
    }
  }
};

export const verifyTestEnvironmentPresence = async (
  organization = testOrganization,
  environment = testEnvironmentName,
) => {
  const params = ['environment', 'list', `--organization=${organization}`];

  const { output } = await trigger(command, params, {});

  if (output.join('').includes(` ${environment} `)) {
    console.log('Environment exists');
    return true;
  }

  console.log('Environment not found');
  return false;
};

export const prepareEnvironment = async () => {
  await createTestProject();
  await createTestEnvironment();
  const environmentKey = await getEnvironmentId();

  return environmentKey;
};

export const createTestEnvironment = async (
  organization = testOrganization,
) => {
  const envExists = await verifyTestEnvironmentPresence(
    organization,
    testEnvironmentName,
  );

  if (!envExists) {
    const params = [
      'env',
      'create',
      testEnvironmentName,
      `--project=${testProjectName}`,
      '--database=sample',
      '--saleor=saleor-master-staging',
      `--domain=saleor-test-domain-${currentDate()}`,
      '--email=test@example.com',
      '--skipRestrict',
      '--deploy',
      `--organization=${organization}`,
    ];

    const { err, exitCode, output } = await trigger(command, params, {});
    if (exitCode !== 0) {
      console.log(exitCode, err, output);
      console.error(err.join());
    }
  }
};

export const removeVercelProject = async (name: string) => {
  if (!process.env.CI) {
    return;
  }

  if (shouldMockTests) {
    return;
  }

  const { vercel_token: VercelToken } = await Config.get();
  const url = `https://api.vercel.com/v9/projects/${name}`;
  console.log(`Removing project: ${url}`);
  await got.delete(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: VercelToken,
    },
  });
};

export const removeGithubRepository = async (name: string, path: string) => {
  if (!process.env.CI) {
    return;
  }

  if (shouldMockTests) {
    return;
  }

  const repoUrl = await getRepoRemoteUrl(path);
  const { owner } = GitUrlParse(repoUrl);
  const url = `https://api.github.com/repos/${owner}/${name}`;
  const { github_token: GithubToken } = await Config.get();
  console.log(`Removing repo: ${url}`);
  await got.delete(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: GithubToken,
    },
  });
};

export const getRepoRemoteUrl = async (path: string) => {
  const child = spawn('git', ['remote', '-v'], { cwd: path });

  const output: string[] = [];
  for await (const data of child.stdout || []) {
    output.push(data.toString());
  }

  return output[0].toString().split(/\s/)[1];
};

export const listProjects = async () => {
  const params = [
    'project',
    'list',
    `--organization=${testOrganization}`,
    '--json',
  ];

  const data = await trigger(
    command,
    params,
    {},
    {
      output: ['[]'],
      err: [],
      exitCode: 0,
    },
  );

  return data;
};

export const clearProjects = async (all = false) => {
  const { output } = await listProjects();

  const projects = JSON.parse(output.join()).map((p) => p.slug);

  const filtered = all
    ? projects
    : projects.filter((p) => p !== testProjectName);

  console.log(`Clearing projects ${filtered}`);

  for (const project of filtered) {
    console.log('project', project);
    await removeProject(project);
  }
};

export const removeProject = async (projectName: string) => {
  const params = [
    'project',
    'remove',
    projectName,
    `--organization=${testOrganization}`,
    '--force',
  ];

  console.log('params', params);

  await trigger(command, params, {});
};

export const getToken = async () => {
  const { token } = await Config.get();
  return token;
};

export const getEnvironment = async (envKey: string) => {
  if (shouldMockTests) {
    return {
      key: envKey,
      name: newTestEnvironmentName,
      maintenance_mode: true,
      protected: true,
      blocking_tasks_in_progress: false,
      allowed_cors_origins: ['https://example.com', 'https://test.com'],
      allowed_client_origins: ['https://example.com', 'https://test.com'],
    };
  }

  const token = await getToken();

  const environment = await (GET(API.Environment, {
    environment: envKey,
    organization: testOrganization,
    token,
  }) as Promise<Environment>);

  return environment;
};

export const removeEnvironment = async (env: string) => {
  const params = [
    'env',
    'remove',
    env,
    `--organization=${testOrganization}`,
    '--force',
  ];

  console.log('params', params);

  await trigger(command, params, {});
};

export const cleanEnvAfterUpdate = async (envKey: string) => {
  if (shouldMockTests) {
    return {
      key: envKey,
      name: testEnvironmentName,
      maintenance_mode: false,
      protected: false,
      allowed_cors_origins: '*',
      allowed_client_origins: [],
    };
  }

  const token = await getToken();

  await waitForBlockingTasks(envKey);

  const environment = await (PATCH(
    API.Environment,
    { environment: envKey, organization: testOrganization, token },
    {
      json: {
        maintenance_mode: false,
        login: null,
        password: null,
        name: testEnvironmentName,
      },
    },
  ) as Promise<Environment>);

  await waitForBlockingTasks(envKey);

  return environment;
};

export const waitForBlockingTasks = async (envKey: string) => {
  const environment = await getEnvironment(envKey);
  let { blocking_tasks_in_progress: blockingTasksInProgress } = environment;

  do {
    delay(1000);
    const current = await getEnvironment(envKey);
    blockingTasksInProgress = current.blocking_tasks_in_progress;
  } while (blockingTasksInProgress);
};
