import { spawn } from 'child_process';
import crypto from 'crypto';

export const randomString = () =>
  crypto.randomBytes(256).toString('hex').substring(0, 7);

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

  const child = spawn('saleor', params, options);

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
    console.log(err);
  }

  return {
    output,
    err,
    exitCode,
  };
};

export const shouldMockTests = !process.env.RUN_FUNCTIONAL_TESTS;
export const command = 'saleor';
export const testOrganization = 'cli-dev';
export const testEnvironmentName = 'saleor-test';
export const testProjectName = 'cli-test';

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

export const prepareEnvironment = async () => {
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
