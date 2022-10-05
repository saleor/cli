import { spawn } from 'child_process';
import GitUrlParse from 'git-url-parse';
import got from 'got';

import { Config } from '../src/lib/config.js';

export const currentDate = () => Date.now().toString();

export const shouldMockTests = !process.env.RUN_FUNCTIONAL_TESTS;
export const command = 'node';
export const buildPath = `${process.env.PWD}/dist/saleor.js`;
export const testOrganization = 'cli-test';
export const testEnvironmentName = 'saleor-test';
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
  defaults = DefaultTriggerResponse
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
  environmentName = testEnvironmentName
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
  project = testProjectName
) => {
  const params = ['project', 'list', `--organization=${organization}`];

  const { err, output } = await trigger(command, params, {});

  if (output.join('').includes(` ${project} `)) {
    console.log('Project exists');
    return true;
  }

  if (err.length > 0) {
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

    const { err } = await trigger(command, params, {});

    if (err.length > 0) {
      throw new Error(err.join());
    }
  }
};

export const prepareEnvironment = async () => {
  await createTestProject();
  await createTestEnvironment();
  const environmentKey = await getEnvironmentId();

  return environmentKey;
};

export const createTestEnvironment = async (
  organization = testOrganization
) => {
  const params = [
    'env',
    'create',
    testEnvironmentName,
    `--project=${testProjectName}`,
    '--database=sample',
    '--saleor=saleor-master-staging',
    '--domain=saleor-test-domain',
    '--email=test@example.com',
    '--skipRestrict',
    '--deploy',
    `--organization=${organization}`,
  ];

  const { err } = await trigger(command, params, {});

  if (err.length > 0) {
    throw new Error(err.join());
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
  console.log(`Removing repo: ${url}`);
  await got.delete(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `token ${process.env.GH_TOKEN}`,
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
