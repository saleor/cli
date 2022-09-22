import { spawn } from 'child_process';

export const trigger = async (
  cmd: string,
  params: string[],
  options: {},
  defaultCode = 0
) => {
  if (!shouldRunCommand) {
    return {
      output: [],
      err: [],
      exitCode: defaultCode,
    };
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

export const shouldRunCommand = !process.env.CI;
export const command = 'saleor';
export const testOrganization = 'cli-dev';
export const testEnvironmentName = 'saleor-test';
export const testProjectName = 'cli-test';

export const getEnvironmentId = async (organization = testOrganization) => {
  const params = [
    'env',
    'show',
    testEnvironmentName,
    `--organization=${organization}`,
    '--json',
  ];
  const { output } = await trigger(command, params, {}, 0);
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
